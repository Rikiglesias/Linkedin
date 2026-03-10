import { getAccountProfileById } from '../accountManager';
import { cleanText } from '../utils/text';
import { cleanLeadDataWithAI } from '../ai/leadDataCleaner';
import { scoreLeadProfile } from '../ai/leadScorer';
import { checkLogin, closeBrowser, detectChallenge, isLoggedIn, launchBrowser } from '../browser';
import { blockUserInput } from '../browser/humanBehavior';
import { batchUpsertCloudLeads, syncSalesNavMembersToCloud } from '../cloud/supabaseDataClient';
import { CloudLeadUpsert } from '../cloud/types';
import { config } from '../config';
import { getDatabase } from '../db';
import { enrichLeadAuto } from '../integrations/leadEnricher';
import { handleChallengeDetected } from '../risk/incidentManager';
import {
    getLeadById,
    getLeadByLinkedinUrl,
    getListScoringCriteria,
    linkLeadToSalesNavList,
    markSalesNavListSynced,
    setLeadStatus,
    updateLeadScores,
    upsertSalesNavList,
    upsertSalesNavigatorLead,
} from './repositories';
import {
    navigateToSavedLists,
    scrapeLeadsFromSalesNavList,
    SalesNavLeadCandidate,
    SalesNavSavedList,
} from '../salesnav/listScraper';

export interface SalesNavigatorSyncOptions {
    listName?: string | null;
    listUrl?: string | null;
    maxPages: number;
    maxLeadsPerList: number;
    dryRun: boolean;
    accountId?: string;
    interactive?: boolean;
    noProxy?: boolean;
}

export interface SalesNavigatorSyncListReport {
    listName: string;
    listUrl: string;
    pagesVisited: number;
    candidatesDiscovered: number;
    uniqueCandidates: number;
    inserted: number;
    updated: number;
    unchanged: number;
    wouldInsert: number;
    wouldUpdate: number;
    errors: number;
    samples: Array<{
        linkedinUrl: string;
        firstName: string;
        lastName: string;
        accountName: string;
        jobTitle: string;
    }>;
}

export interface DbSnapshot {
    totalLeads: number;
    byStatus: Record<string, number>;
    withEmail: number;
    withScore: number;
    salesNavUrls: number;
    listsCount: number;
}

export interface PostSyncEnrichmentReport {
    leadsProcessed: number;
    dataCleaned: number;
    scored: number;
    enriched: number;
    promoted: number;
    errors: number;
    cloudSynced: number;
    cloudErrors: number;
}

export interface SalesNavigatorSyncReport {
    accountId: string;
    dryRun: boolean;
    listFilter: string | null;
    listDiscoveryCount: number;
    maxPages: number;
    maxLeadsPerList: number;
    pagesVisited: number;
    candidatesDiscovered: number;
    uniqueCandidates: number;
    inserted: number;
    updated: number;
    unchanged: number;
    wouldInsert: number;
    wouldUpdate: number;
    errors: number;
    challengeDetected: boolean;
    lists: SalesNavigatorSyncListReport[];
    enrichment: PostSyncEnrichmentReport;
    dbBefore: DbSnapshot | null;
    dbAfter: DbSnapshot | null;
    durationMs: number;
}

function matchesListNameFilter(list: SalesNavSavedList, filter: string): boolean {
    const normalizedFilter = filter.toLowerCase();
    const normalizedName = cleanText(list.name).toLowerCase();
    return normalizedName === normalizedFilter || normalizedName.includes(normalizedFilter);
}

function toSample(candidate: SalesNavLeadCandidate): SalesNavigatorSyncListReport['samples'][number] {
    return {
        linkedinUrl: candidate.linkedinUrl,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        accountName: candidate.accountName,
        jobTitle: candidate.jobTitle,
    };
}

async function takeDbSnapshot(): Promise<DbSnapshot> {
    const db = await getDatabase();
    const totalRow = await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM leads`);
    const statusRows = await db.query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) as cnt FROM leads GROUP BY status ORDER BY cnt DESC`,
    );
    const emailRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE email IS NOT NULL AND TRIM(email) <> ''`,
    );
    const scoreRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE lead_score IS NOT NULL`,
    );
    const salesNavRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE linkedin_url LIKE '%/sales/%'`,
    );
    const listsRow = await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM salesnav_lists`);

    const byStatus: Record<string, number> = {};
    for (const row of statusRows) {
        byStatus[row.status] = row.cnt;
    }

    return {
        totalLeads: totalRow?.total ?? 0,
        byStatus,
        withEmail: emailRow?.total ?? 0,
        withScore: scoreRow?.total ?? 0,
        salesNavUrls: salesNavRow?.total ?? 0,
        listsCount: listsRow?.total ?? 0,
    };
}

export function formatFinalReport(report: SalesNavigatorSyncReport): string {
    const lines: string[] = [];
    const sec = Math.round(report.durationMs / 1000);
    const min = Math.floor(sec / 60);
    const durStr = min > 0 ? `${min}m ${sec % 60}s` : `${sec}s`;

    lines.push('');
    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║              REPORT FINALE SALESNAV SYNC                    ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    lines.push('');

    // ─── Sezione 1: Parametri ────────────────────────────────────────────
    lines.push('─── PARAMETRI ────────────────────────────────────────────────');
    lines.push(`  Account:        ${report.accountId}`);
    lines.push(`  Filtro lista:   ${report.listFilter ?? '(tutte)'}`);
    lines.push(`  Dry run:        ${report.dryRun ? 'SI' : 'NO'}`);
    lines.push(`  Max pagine:     ${report.maxPages}`);
    lines.push(`  Max lead/lista: ${report.maxLeadsPerList}`);
    lines.push(`  Durata:         ${durStr}`);
    lines.push('');

    // ─── Sezione 2: Scraping ─────────────────────────────────────────────
    lines.push('─── ESTRAZIONE BROWSER ───────────────────────────────────────');
    lines.push(`  Liste trovate:        ${report.listDiscoveryCount}`);
    lines.push(`  Liste processate:     ${report.lists.length}`);
    lines.push(`  Pagine visitate:      ${report.pagesVisited}`);
    lines.push(`  Candidati scoperti:   ${report.candidatesDiscovered}`);
    lines.push(`  Candidati unici:      ${report.uniqueCandidates}`);
    if (report.challengeDetected) {
        lines.push(`  ⚠ CHALLENGE:          RILEVATO (sync interrotto)`);
    }
    lines.push('');

    // ─── Sezione 3: Database ─────────────────────────────────────────────
    lines.push('─── OPERAZIONI DATABASE ──────────────────────────────────────');
    if (report.dryRun) {
        lines.push(`  Sarebbero inseriti:   ${report.wouldInsert}`);
        lines.push(`  Sarebbero aggiornati: ${report.wouldUpdate}`);
    } else {
        lines.push(`  Inseriti (nuovi):     ${report.inserted}`);
        lines.push(`  Aggiornati:           ${report.updated}`);
        lines.push(`  Invariati:            ${report.unchanged}`);
    }
    lines.push(`  Errori upsert:        ${report.errors}`);
    lines.push('');

    // ─── Sezione 4: AI Enrichment ────────────────────────────────────────
    const e = report.enrichment;
    lines.push('─── AI ENRICHMENT (post-sync) ────────────────────────────────');
    lines.push(`  Lead processati:      ${e.leadsProcessed}`);
    lines.push(`  Dati puliti con AI:   ${e.dataCleaned}`);
    lines.push(`  Scorati con AI:       ${e.scored}`);
    lines.push(`  Email trovate:        ${e.enriched}`);
    lines.push(`  Promossi READY:       ${e.promoted}`);
    lines.push(`  Errori enrichment:    ${e.errors}`);
    lines.push('');

    // ─── Sezione 4b: Cloud Sync ───────────────────────────────────────────
    lines.push('─── CLOUD SYNC (Supabase) ────────────────────────────────────');
    if (e.cloudSynced > 0 || e.cloudErrors > 0) {
        lines.push(`  Lead sincronizzati:   ${e.cloudSynced}`);
        lines.push(`  Errori cloud:         ${e.cloudErrors}`);
    } else {
        lines.push(`  Stato:                ${config.supabaseSyncEnabled ? 'Nessun lead da sincronizzare' : 'DISABILITATO'}`);
    }
    lines.push('');

    // ─── Sezione 5: Snapshot DB ──────────────────────────────────────────
    if (report.dbBefore && report.dbAfter) {
        const b = report.dbBefore;
        const a = report.dbAfter;
        const diff = (val: number, prev: number) => {
            const d = val - prev;
            return d > 0 ? ` (+${d})` : d < 0 ? ` (${d})` : '';
        };

        lines.push('─── STATO DATABASE ───────────────────────────────────────────');
        lines.push(`  Lead totali:          ${a.totalLeads}${diff(a.totalLeads, b.totalLeads)}`);
        lines.push(`  Con email:            ${a.withEmail}${diff(a.withEmail, b.withEmail)}`);
        lines.push(`  Con AI score:         ${a.withScore}${diff(a.withScore, b.withScore)}`);
        lines.push(`  URL SalesNav:         ${a.salesNavUrls}${diff(a.salesNavUrls, b.salesNavUrls)}`);
        lines.push(`  Liste SalesNav:       ${a.listsCount}${diff(a.listsCount, b.listsCount)}`);
        lines.push('');

        lines.push('  Lead per status:');
        const allStatuses = new Set([...Object.keys(b.byStatus), ...Object.keys(a.byStatus)]);
        for (const status of [...allStatuses].sort()) {
            const before = b.byStatus[status] ?? 0;
            const after = a.byStatus[status] ?? 0;
            lines.push(`    ${status.padEnd(20)} ${String(after).padStart(5)}${diff(after, before)}`);
        }
        lines.push('');
    }

    // ─── Sezione 6: Dettaglio per lista ──────────────────────────────────
    if (report.lists.length > 0) {
        lines.push('─── DETTAGLIO PER LISTA ──────────────────────────────────────');
        for (const list of report.lists) {
            lines.push(`  ▸ ${list.listName}`);
            lines.push(`    Pagine: ${list.pagesVisited}  Candidati: ${list.candidatesDiscovered}  Unici: ${list.uniqueCandidates}`);
            if (report.dryRun) {
                lines.push(`    Inserimento: ${list.wouldInsert}  Aggiornamento: ${list.wouldUpdate}`);
            } else {
                lines.push(`    Inseriti: ${list.inserted}  Aggiornati: ${list.updated}  Invariati: ${list.unchanged}  Errori: ${list.errors}`);
            }
            if (list.samples.length > 0) {
                lines.push(`    Top campioni:`);
                for (const s of list.samples.slice(0, 5)) {
                    lines.push(`      - ${s.firstName} ${s.lastName} | ${s.accountName} | ${s.jobTitle}`);
                }
            }
            lines.push('');
        }
    }

    lines.push('══════════════════════════════════════════════════════════════');
    return lines.join('\n');
}

async function postSyncEnrichment(
    leadIds: number[],
    listName: string,
    dryRun: boolean,
): Promise<PostSyncEnrichmentReport> {
    const enrichReport: PostSyncEnrichmentReport = {
        leadsProcessed: 0,
        dataCleaned: 0,
        scored: 0,
        enriched: 0,
        promoted: 0,
        errors: 0,
        cloudSynced: 0,
        cloudErrors: 0,
    };
    if (dryRun || leadIds.length === 0) return enrichReport;

    const db = await getDatabase();
    const scoringCriteria = await getListScoringCriteria(listName);
    const total = leadIds.length;

    console.log(`\n[POST-SYNC] Enrichment per ${total} lead...`);
    for (let i = 0; i < total; i++) {
        const leadId = leadIds[i];
        if (!leadId) continue;
        const progress = `[${i + 1}/${total}]`;
        enrichReport.leadsProcessed += 1;
        try {
            let lead = await getLeadById(leadId);
            if (!lead) continue;

            const fullName = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim();

            // Skip se lead gia completamente arricchito (ha title + company + email + score)
            const alreadyComplete = !!(lead.job_title && lead.account_name && lead.email && lead.lead_score !== null);
            if (alreadyComplete) {
                continue;
            }

            // 1. Data cleaning AI — pulisci nomi, titoli spazzatura, company vuote
            const cleanResult = await cleanLeadDataWithAI({
                firstName: lead.first_name ?? '',
                lastName: lead.last_name ?? '',
                jobTitle: lead.job_title ?? '',
                accountName: lead.account_name ?? '',
                linkedinUrl: lead.linkedin_url,
                website: lead.website,
            });
            if (cleanResult.cleaned) {
                const sets: string[] = [];
                const params: unknown[] = [];

                if (cleanResult.firstName && cleanResult.firstName !== lead.first_name) {
                    sets.push('first_name = ?');
                    params.push(cleanResult.firstName);
                }
                if (cleanResult.lastName && cleanResult.lastName !== lead.last_name) {
                    sets.push('last_name = ?');
                    params.push(cleanResult.lastName);
                }
                if (cleanResult.jobTitle !== undefined && cleanResult.jobTitle !== lead.job_title) {
                    sets.push('job_title = ?');
                    params.push(cleanResult.jobTitle ?? '');
                }
                if (cleanResult.accountName !== undefined && cleanResult.accountName !== lead.account_name) {
                    sets.push('account_name = ?');
                    params.push(cleanResult.accountName ?? '');
                }
                if (cleanResult.inferredEmail && !lead.email) {
                    sets.push('email = ?');
                    params.push(cleanResult.inferredEmail);
                }

                if (sets.length > 0) {
                    sets.push('updated_at = CURRENT_TIMESTAMP');
                    params.push(leadId);
                    await db.run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, params);
                    enrichReport.dataCleaned += 1;
                    console.log(`  ${progress} [CLEAN] ${fullName}: title=${cleanResult.jobTitle ?? '(null)'} company=${cleanResult.accountName ?? '(null)'}${cleanResult.inferredEmail ? ` email=${cleanResult.inferredEmail}` : ''}`);
                    lead = (await getLeadById(leadId)) ?? lead;
                }
            }

            // 2. Data enrichment (Apollo/Hunter/Clearbit + PersonDataFinder OSINT) — email, phone, job title, company, ecc.
            const needsEnrich = !lead.email || !lead.job_title || !lead.account_name;
            if (needsEnrich) {
                // Prima prova API standard; se non trova email e il lead ha un dominio, attiva deep enrichment OSINT
                const hasWebsite = !!(lead.website || lead.account_name);
                const enrichResult = await enrichLeadAuto({
                    id: leadId,
                    first_name: lead.first_name,
                    last_name: lead.last_name,
                    website: lead.website,
                    account_name: lead.account_name,
                    linkedin_url: lead.linkedin_url,
                    company_domain: lead.company_domain,
                    location: lead.location,
                }, { deep: hasWebsite });

                if (enrichResult.source !== 'none') {
                    const sets: string[] = [];
                    const params: unknown[] = [];

                    if (enrichResult.email && !lead.email) {
                        sets.push('email = ?'); params.push(enrichResult.email);
                    }
                    if (enrichResult.phone && !lead.phone) {
                        sets.push('phone = ?'); params.push(enrichResult.phone);
                    }
                    if (enrichResult.jobTitle && !lead.job_title) {
                        sets.push('job_title = ?'); params.push(enrichResult.jobTitle);
                    }
                    if (enrichResult.companyName && !lead.account_name) {
                        sets.push('account_name = ?'); params.push(enrichResult.companyName);
                    }
                    if (enrichResult.companyDomain && !lead.website) {
                        sets.push('website = ?'); params.push(enrichResult.companyDomain);
                    }
                    if (enrichResult.companyDomain) {
                        sets.push('company_domain = COALESCE(company_domain, ?)'); params.push(enrichResult.companyDomain);
                    }
                    if (enrichResult.businessEmail) {
                        sets.push('business_email = COALESCE(business_email, ?)'); params.push(enrichResult.businessEmail);
                        sets.push('business_email_confidence = CASE WHEN business_email IS NOT NULL THEN business_email_confidence ELSE ? END');
                        params.push(enrichResult.businessEmailConfidence);
                    }

                    if (sets.length > 0) {
                        sets.push('updated_at = CURRENT_TIMESTAMP');
                        params.push(leadId);
                        await db.run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, params);
                        enrichReport.enriched += 1;
                        lead = (await getLeadById(leadId)) ?? lead;

                        const parts: string[] = [];
                        if (enrichResult.email) parts.push(`email=${enrichResult.email}`);
                        if (enrichResult.jobTitle) parts.push(`title=${enrichResult.jobTitle}`);
                        if (enrichResult.companyName) parts.push(`company=${enrichResult.companyName}`);
                        if (enrichResult.phone) parts.push(`phone=${enrichResult.phone}`);
                        if (enrichResult.location) parts.push(`loc=${enrichResult.location}`);
                        if (enrichResult.industry) parts.push(`industry=${enrichResult.industry}`);
                        console.log(`  ${progress} [ENRICH] ${fullName}: ${parts.join(' | ')} (${enrichResult.source})`);
                    }
                }

                // Rate limiting: pausa tra chiamate API per evitare ban
                if (i < total - 1) {
                    await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 300)));
                }
            }

            // 3. AI Scoring — solo se non ancora scorato, o ri-scora se arricchito con nuovi dati
            const needsScore = lead.lead_score === null || lead.lead_score === undefined;
            const wasEnriched = enrichReport.enriched > 0 && (lead.job_title || lead.account_name);
            if (needsScore || wasEnriched) {
                const scoreResult = await scoreLeadProfile(
                    lead.account_name ?? '',
                    `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim(),
                    lead.job_title ?? null,
                    { scoringCriteria },
                );
                await updateLeadScores(leadId, scoreResult.leadScore, scoreResult.confidenceScore);
                lead.lead_score = scoreResult.leadScore;
                enrichReport.scored += 1;
                const label = wasEnriched && !needsScore ? 'RE-SCORE' : 'SCORE';
                console.log(`  ${progress} [${label}] ${fullName}: score=${scoreResult.leadScore} confidence=${scoreResult.confidenceScore} (${scoreResult.reason})`);
            }

            // 4. Promozione NEW → READY_INVITE se ha score sufficiente
            if (lead.status === 'NEW' && lead.lead_score !== null && lead.lead_score >= 30) {
                await setLeadStatus(leadId, 'READY_INVITE');
                enrichReport.promoted += 1;
                console.log(`  ${progress} [PROMOTE] ${fullName}: NEW → READY_INVITE (score=${lead.lead_score})`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ${progress} [ERROR] lead #${leadId}: ${msg}`);
            enrichReport.errors += 1;
        }
    }

    console.log(`[POST-SYNC] Completato: cleaned=${enrichReport.dataCleaned} enriched=${enrichReport.enriched} scored=${enrichReport.scored} promoted=${enrichReport.promoted} errors=${enrichReport.errors}`);

    // 5. Cloud sync → Supabase (non-bloccante: errori loggati ma non propagati)
    if (config.supabaseSyncEnabled) {
        console.log(`[CLOUD-SYNC] Push ${total} lead verso Supabase...`);
        try {
            const cloudLeads: CloudLeadUpsert[] = [];
            for (const leadId of leadIds) {
                const lead = await getLeadById(leadId);
                if (!lead) continue;
                cloudLeads.push({
                    local_id: lead.id,
                    linkedin_url: lead.linkedin_url,
                    first_name: lead.first_name ?? '',
                    last_name: lead.last_name ?? '',
                    job_title: lead.job_title ?? '',
                    account_name: lead.account_name ?? '',
                    website: lead.website ?? '',
                    list_name: listName,
                    status: lead.status,
                    invited_at: lead.invited_at ?? null,
                    accepted_at: lead.accepted_at ?? null,
                    email: lead.email ?? null,
                    phone: lead.phone ?? null,
                    location: lead.location ?? null,
                    salesnav_url: lead.salesnav_url ?? null,
                    lead_score: lead.lead_score ?? null,
                    confidence_score: lead.confidence_score ?? null,
                    company_domain: lead.company_domain ?? null,
                    business_email: lead.business_email ?? null,
                    business_email_confidence: lead.business_email_confidence ?? null,
                });
            }
            if (cloudLeads.length > 0) {
                await batchUpsertCloudLeads(cloudLeads);
                enrichReport.cloudSynced = cloudLeads.length;
                console.log(`  [CLOUD] ${cloudLeads.length} lead sincronizzati su Supabase.`);
            }

            // Sync anche salesnav_list_members
            const membersSynced = await syncSalesNavMembersToCloud(db);
            if (membersSynced > 0) {
                console.log(`  [CLOUD] ${membersSynced} salesnav_list_members sincronizzati.`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  [CLOUD-SYNC] Errore sync Supabase: ${msg}`);
            enrichReport.cloudErrors += 1;
        }
    }

    return enrichReport;
}

export async function runSalesNavigatorListSync(options: SalesNavigatorSyncOptions): Promise<SalesNavigatorSyncReport> {
    const listFilter = cleanText(options.listName) || null;
    const explicitListUrl = cleanText(options.listUrl) || null;
    const maxPages = Math.max(1, options.maxPages);
    const maxLeadsPerList = Math.max(1, options.maxLeadsPerList);
    const account = getAccountProfileById(options.accountId);

    const report: SalesNavigatorSyncReport = {
        accountId: account.id,
        dryRun: options.dryRun,
        listFilter,
        listDiscoveryCount: 0,
        maxPages,
        maxLeadsPerList,
        pagesVisited: 0,
        candidatesDiscovered: 0,
        uniqueCandidates: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        wouldInsert: 0,
        wouldUpdate: 0,
        errors: 0,
        challengeDetected: false,
        lists: [],
        enrichment: { leadsProcessed: 0, dataCleaned: 0, scored: 0, enriched: 0, promoted: 0, errors: 0, cloudSynced: 0, cloudErrors: 0 },
        dbBefore: null,
        dbAfter: null,
        durationMs: 0,
    };

    const startTime = Date.now();
    report.dbBefore = await takeDbSnapshot().catch(() => null);

    const interactive = options.interactive === true;
    const noProxy = options.noProxy === true;
    // Anti-detection completa SEMPRE — non solo interactive
    const session = await launchBrowser({
        headless: !interactive,
        sessionDir: account.sessionDir,
        proxy: noProxy ? undefined : account.proxy,
        bypassProxy: noProxy,
        forceDesktop: true,
    });

    let browserClosed = false;
    const allSyncedLeadIds: Array<{ id: number; listName: string }> = [];

    try {
        let loggedIn = await checkLogin(session.page);
        if (!loggedIn && interactive) {
            const currentUrl = session.page.url().toLowerCase();
            if (!currentUrl.includes('/login')) {
                await session.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' }).catch(() => null);
            }
            console.log('\n──────────────────────────────────────────────────────────────');
            console.log('  SalesNav sync pronto. Effettua il LOGIN nel browser aperto.');
            console.log('  Quando sei loggato, premi INVIO qui per continuare.');
            console.log('──────────────────────────────────────────────────────────────\n');
            // Attendi login interattivo (max 5 min)
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                if (await isLoggedIn(session.page)) {
                    loggedIn = await checkLogin(session.page);
                    if (loggedIn) break;
                }
                await session.page.waitForTimeout(2500);
            }
        }
        if (!loggedIn) {
            throw new Error(`Sales Navigator sync: sessione non autenticata (account=${account.id}).`);
        }
        // blockUserInput solo in modalità automatica — in interactive l'utente deve poter usare il mouse
        if (!interactive) {
            await blockUserInput(session.page);
        }
        if (interactive) {
            console.log('[OK] Login rilevato. Avvio sync lista (mouse libero)...');
        }

        let targetLists: SalesNavSavedList[] = [];
        if (explicitListUrl) {
            targetLists = [
                {
                    name: listFilter || 'default',
                    url: explicitListUrl,
                },
            ];
        } else {
            const discovered = await navigateToSavedLists(session.page);
            // Re-inject overlay dopo navigazione (il DOM viene distrutto da page.goto)
            if (!interactive) await blockUserInput(session.page);
            report.listDiscoveryCount = discovered.length;
            if (listFilter) {
                targetLists = discovered.filter((entry) => matchesListNameFilter(entry, listFilter));
            } else {
                targetLists = discovered;
            }
        }

        if (targetLists.length === 0) {
            const discoveredNames = (await navigateToSavedLists(session.page).catch(() => [] as SalesNavSavedList[]))
                .map((l) => l.name);
            const hint = discoveredNames.length > 0
                ? ` Liste trovate: [${discoveredNames.join(', ')}]. Usa --list "NOME" o --url <url>.`
                : ' Nessuna lista trovata nella pagina SalesNav.';
            throw new Error(`Sales Navigator sync: nessuna lista corrisponde al filtro "${listFilter || '(nessuno)'}".${hint}`);
        }

        for (const targetList of targetLists) {
            const listName = cleanText(targetList.name) || 'default';
            const listUrl = cleanText(targetList.url);
            const listReport: SalesNavigatorSyncListReport = {
                listName,
                listUrl,
                pagesVisited: 0,
                candidatesDiscovered: 0,
                uniqueCandidates: 0,
                inserted: 0,
                updated: 0,
                unchanged: 0,
                wouldInsert: 0,
                wouldUpdate: 0,
                errors: 0,
                samples: [],
            };

            const scraped = await scrapeLeadsFromSalesNavList(session.page, {
                listUrl,
                maxPages,
                leadLimit: maxLeadsPerList,
                interactive,
            });
            listReport.pagesVisited = scraped.pagesVisited;
            listReport.candidatesDiscovered = scraped.candidatesDiscovered;
            listReport.uniqueCandidates = scraped.uniqueCandidates;

            report.pagesVisited += scraped.pagesVisited;
            report.candidatesDiscovered += scraped.candidatesDiscovered;
            report.uniqueCandidates += scraped.uniqueCandidates;

            if (await detectChallenge(session.page)) {
                report.challengeDetected = true;
                await handleChallengeDetected({
                    source: 'salesnav_sync',
                    accountId: account.id,
                    linkedinUrl: listUrl,
                    message: 'Challenge rilevato durante sincronizzazione Sales Navigator',
                    extra: {
                        listName,
                        listUrl,
                    },
                });
                report.lists.push(listReport);
                break;
            }

            const listRow = options.dryRun ? null : await upsertSalesNavList(listName, listUrl);
            const syncedLeadIds: number[] = [];
            for (const candidate of scraped.leads) {
                if (listReport.samples.length < 10) {
                    listReport.samples.push(toSample(candidate));
                }
                try {
                    if (options.dryRun) {
                        const existing = await getLeadByLinkedinUrl(candidate.linkedinUrl);
                        if (existing) {
                            listReport.wouldUpdate += 1;
                            report.wouldUpdate += 1;
                        } else {
                            listReport.wouldInsert += 1;
                            report.wouldInsert += 1;
                        }
                        continue;
                    }

                    // Preferisci URL pubblico /in/ se disponibile; preserva SalesNav URL separatamente
                    const isSalesNavUrl = /\/sales\/lead\//.test(candidate.linkedinUrl);
                    const primaryUrl = candidate.publicProfileUrl || candidate.linkedinUrl;
                    const salesnavUrl = isSalesNavUrl ? candidate.linkedinUrl : undefined;
                    const upserted = await upsertSalesNavigatorLead({
                        listName,
                        linkedinUrl: primaryUrl,
                        accountName: candidate.accountName,
                        firstName: candidate.firstName,
                        lastName: candidate.lastName,
                        jobTitle: candidate.jobTitle,
                        website: candidate.website,
                        location: candidate.location || undefined,
                        salesnavUrl,
                    });

                    if (listRow && upserted.leadId > 0) {
                        await linkLeadToSalesNavList(listRow.id, upserted.leadId);
                    }

                    if (upserted.leadId > 0) {
                        syncedLeadIds.push(upserted.leadId);
                    }

                    if (upserted.action === 'inserted') {
                        listReport.inserted += 1;
                        report.inserted += 1;
                    } else if (upserted.action === 'updated') {
                        listReport.updated += 1;
                        report.updated += 1;
                    } else {
                        listReport.unchanged += 1;
                        report.unchanged += 1;
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error(`[SYNC] Errore upsert lead ${candidate.linkedinUrl}: ${msg}`);
                    listReport.errors += 1;
                    report.errors += 1;
                }
            }

            if (listRow && !options.dryRun) {
                await markSalesNavListSynced(listRow.id);
            }

            report.lists.push(listReport);
            allSyncedLeadIds.push(...syncedLeadIds.map(id => ({ id, listName })));
        }

        // Chiudi browser SUBITO dopo scraping (non serve piu per enrichment)
        await closeBrowser(session);
        browserClosed = true;
        console.log('[OK] Browser chiuso. Avvio enrichment offline...');

        // Post-sync enrichment per tutti i lead estratti (no browser needed)
        const byList = new Map<string, number[]>();
        for (const entry of allSyncedLeadIds) {
            const arr = byList.get(entry.listName) ?? [];
            arr.push(entry.id);
            byList.set(entry.listName, arr);
        }
        for (const [ln, ids] of byList) {
            const enrichResult = await postSyncEnrichment(ids, ln, options.dryRun);
            report.enrichment.leadsProcessed += enrichResult.leadsProcessed;
            report.enrichment.dataCleaned += enrichResult.dataCleaned;
            report.enrichment.scored += enrichResult.scored;
            report.enrichment.enriched += enrichResult.enriched;
            report.enrichment.promoted += enrichResult.promoted;
            report.enrichment.errors += enrichResult.errors;
            report.enrichment.cloudSynced += enrichResult.cloudSynced;
            report.enrichment.cloudErrors += enrichResult.cloudErrors;
        }

        report.dbAfter = await takeDbSnapshot().catch(() => null);
        report.durationMs = Date.now() - startTime;
        return report;
    } finally {
        if (!browserClosed) {
            await closeBrowser(session);
        }
    }
}
