import { getAccountProfileById } from '../accountManager';
import { maskName, maskEmail, maskPhone } from '../security/redaction';
import { cleanText } from '../utils/text';
import { cleanLeadDataWithAI } from '../ai/leadDataCleaner';
import { scoreLeadProfile } from '../ai/leadScorer';
import { checkLogin, closeBrowser, detectChallenge, humanDelay, launchBrowser, type BrowserSession } from '../browser';
import { attemptChallengeResolution } from '../workers/challengeHandler';
import { awaitManualLogin, blockUserInput } from '../browser/humanBehavior';
import { enableWindowClickThrough, disableWindowClickThrough } from '../browser/windowInputBlock';
import { batchUpsertCloudLeads, syncSalesNavMembersToCloud } from '../cloud/supabaseDataClient';
import { CloudLeadUpsert } from '../cloud/types';
import { config } from '../config';
import { getDatabase } from '../db';
import { enrichLeadAuto } from '../integrations/leadEnricher';
import { triggerLiveEnrichment } from '../integrations/liveEnrichmentTrigger';
import { handleChallengeDetected } from '../risk/incidentManager';
import {
    getLeadById,
    getLeadByLinkedinUrl,
    getListScoringCriteria,
    getRuntimeFlag,
    linkLeadToSalesNavList,
    markSalesNavListSynced,
    setRuntimeFlag,
    updateLeadScores,
    upsertSalesNavList,
    upsertSalesNavigatorLead,
    pushOutboxEvent,
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
    /** Se true, salta enrichment post-sync (Apollo/Hunter/OSINT/scoring/cloud) */
    skipEnrichment?: boolean;
    /** Sessione browser esistente da riusare (evita apertura doppio browser) */
    existingSession?: BrowserSession;
}

export interface SalesNavigatorSyncListReport {
    listName: string;
    listUrl: string;
    pagesVisited: number;
    /** Conteggio LORDO degli anchor DOM visti durante lo scrape (può superare i lead reali). Solo telemetria/display. */
    candidatesDiscovered: number;
    /** Dedup per linkedinUrl DENTRO la singola lista. Solo telemetria/display. */
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
    /** Somma dei lordi per-lista (anchor DOM, può superare i lead reali). Solo telemetria/display (G3-LOW). */
    candidatesDiscovered: number;
    /**
     * Somma degli unici PER-LISTA: un lead presente in 2+ liste è contato una volta per lista
     * (NON è un dedup cross-lista). Solo telemetria/display — nessun consumer decisionale (G3-LOW:
     * verificato 2026-06-11, consumer = formatFinalReport + payload candidati_unici di syncListService).
     */
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
    const normalizedName = cleanText(list.name).toLowerCase();
    const filters = filter
        .split(',')
        .map((f) => f.trim().toLowerCase())
        .filter(Boolean);
    return filters.some((f) => normalizedName === f || normalizedName.includes(f));
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
        lines.push(
            `  Stato:                ${config.supabaseSyncEnabled ? 'Nessun lead da sincronizzare' : 'DISABILITATO'}`,
        );
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
            lines.push(
                `    Pagine: ${list.pagesVisited}  Candidati: ${list.candidatesDiscovered}  Unici: ${list.uniqueCandidates}`,
            );
            if (report.dryRun) {
                lines.push(`    Inserimento: ${list.wouldInsert}  Aggiornamento: ${list.wouldUpdate}`);
            } else {
                lines.push(
                    `    Inseriti: ${list.inserted}  Aggiornati: ${list.updated}  Invariati: ${list.unchanged}  Errori: ${list.errors}`,
                );
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
                    console.log(
                        `  ${progress} [CLEAN] ${maskName(fullName)}: title=${cleanResult.jobTitle ?? '(null)'} company=${cleanResult.accountName ?? '(null)'}${cleanResult.inferredEmail ? ` email=${maskEmail(cleanResult.inferredEmail)}` : ''}`,
                    );
                    lead = (await getLeadById(leadId)) ?? lead;
                }
            }

            // 2. Data enrichment (Apollo/Hunter/Clearbit + PersonDataFinder OSINT) — email, phone, job title, company, ecc.
            let wasEnrichedThisRound = false;
            const needsEnrich = !lead.email || !lead.job_title || !lead.account_name;
            if (needsEnrich) {
                // Prima prova API standard; se non trova email e il lead ha un dominio, attiva deep enrichment OSINT
                const hasWebsite = !!(lead.website || lead.account_name);
                const enrichResult = await enrichLeadAuto(
                    {
                        id: leadId,
                        first_name: lead.first_name,
                        last_name: lead.last_name,
                        website: lead.website,
                        account_name: lead.account_name,
                        linkedin_url: lead.linkedin_url,
                        company_domain: lead.company_domain,
                        location: lead.location,
                    },
                    { deep: hasWebsite },
                );

                if (enrichResult.source !== 'none') {
                    const sets: string[] = [];
                    const params: unknown[] = [];

                    if (enrichResult.email && !lead.email) {
                        sets.push('email = ?');
                        params.push(enrichResult.email);
                    }
                    if (enrichResult.phone && !lead.phone) {
                        sets.push('phone = ?');
                        params.push(enrichResult.phone);
                    }
                    if (enrichResult.jobTitle && !lead.job_title) {
                        sets.push('job_title = ?');
                        params.push(enrichResult.jobTitle);
                    }
                    if (enrichResult.companyName && !lead.account_name) {
                        sets.push('account_name = ?');
                        params.push(enrichResult.companyName);
                    }
                    if (enrichResult.companyDomain && !lead.website) {
                        sets.push('website = ?');
                        params.push(enrichResult.companyDomain);
                    }
                    if (enrichResult.companyDomain) {
                        sets.push('company_domain = COALESCE(company_domain, ?)');
                        params.push(enrichResult.companyDomain);
                    }
                    if (enrichResult.businessEmail) {
                        sets.push('business_email = COALESCE(business_email, ?)');
                        params.push(enrichResult.businessEmail);
                        sets.push(
                            'business_email_confidence = CASE WHEN business_email IS NOT NULL THEN business_email_confidence ELSE ? END',
                        );
                        params.push(enrichResult.businessEmailConfidence);
                    }

                    if (sets.length > 0) {
                        sets.push('updated_at = CURRENT_TIMESTAMP');
                        params.push(leadId);
                        await db.run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, params);
                        enrichReport.enriched += 1;
                        wasEnrichedThisRound = true;
                        lead = (await getLeadById(leadId)) ?? lead;

                        const parts: string[] = [];
                        if (enrichResult.email) parts.push(`email=${maskEmail(enrichResult.email)}`);
                        if (enrichResult.jobTitle) parts.push(`title=${enrichResult.jobTitle}`);
                        if (enrichResult.companyName) parts.push(`company=${enrichResult.companyName}`);
                        if (enrichResult.phone) parts.push(`phone=${maskPhone(enrichResult.phone)}`);
                        if (enrichResult.location) parts.push(`loc=${enrichResult.location}`);
                        if (enrichResult.industry) parts.push(`industry=${enrichResult.industry}`);
                        console.log(
                            `  ${progress} [ENRICH] ${maskName(fullName)}: ${parts.join(' | ')} (${enrichResult.source})`,
                        );
                    }
                }

                // Rate limiting: pausa tra chiamate API per evitare ban
                if (i < total - 1) {
                    await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 300)));
                }
            }

            // 3. AI Scoring — solo se non ancora scorato, o ri-scora se arricchito con nuovi dati
            const needsScore = lead.lead_score === null || lead.lead_score === undefined;
            const wasEnriched = wasEnrichedThisRound && (lead.job_title || lead.account_name);
            if (needsScore || wasEnriched) {
                const scoreResult = await scoreLeadProfile(
                    lead.account_name ?? '',
                    `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim(),
                    lead.job_title ?? null,
                    { scoringCriteria },
                );
                if (scoreResult.reason === 'API_ERROR_FALLBACK') {
                    // CL2 fail-open fix: lo scoring AI è fallito (API down/timeout) e ha prodotto un
                    // punteggio fittizio (50/50). NON persisterlo: (a) bloccherebbe il re-scoring futuro
                    // (needsScore resterebbe false perché lead_score != null), (b) auto-promuoverebbe a
                    // READY_INVITE (gate `>= 30` sotto) un lead MAI realmente qualificato dall'AI →
                    // inviti a target non verificati → acceptance basso → pending ratio → rischio ban.
                    // Lasciamo lead_score null: verrà ri-scorato quando l'AI torna disponibile.
                    console.log(
                        `  ${progress} [SCORE-SKIP] ${maskName(fullName)}: AI scoring non disponibile (fallback), re-scoring rimandato`,
                    );
                } else {
                    await updateLeadScores(leadId, scoreResult.leadScore, scoreResult.confidenceScore);
                    lead.lead_score = scoreResult.leadScore;
                    lead.confidence_score = scoreResult.confidenceScore;
                    enrichReport.scored += 1;
                    const label = wasEnriched && !needsScore ? 'RE-SCORE' : 'SCORE';
                    console.log(
                        `  ${progress} [${label}] ${maskName(fullName)}: score=${scoreResult.leadScore} confidence=${scoreResult.confidenceScore} (${scoreResult.reason})`,
                    );
                }
            }

            // 4. Promozione NEW → READY_INVITE se score sufficiente E confidence affidabile.
            // CL2b (collaudo): allineato a companyEnrichment.ts:213 — un lead con confidence < 70 NON
            // e' abbastanza verificato (l'AI non e' sicura che lavori davvero nell'azienda target) per
            // l'auto-invito: inviare a target non verificati abbassa l'acceptance e alza il pending
            // ratio (rischio ban). Score>=30 ma confidence bassa → REVIEW_REQUIRED (revisione umana),
            // non auto-invito. REVIEW_REQUIRED può tornare a READY_INVITE dopo l'OK umano (no limbo).
            if (lead.status === 'NEW' && lead.lead_score !== null && lead.lead_score >= 30) {
                const { transitionLead } = await import('./leadStateService');
                const confident = (lead.confidence_score ?? 0) >= 70;
                const target = confident ? 'READY_INVITE' : 'REVIEW_REQUIRED';
                await transitionLead(
                    leadId,
                    target,
                    confident ? 'enrichment_score_threshold' : 'low_confidence_needs_review',
                    { score: lead.lead_score, confidence: lead.confidence_score ?? null, listName },
                );
                if (confident) enrichReport.promoted += 1;
                console.log(
                    `  ${progress} [${confident ? 'PROMOTE' : 'REVIEW'}] ${maskName(fullName)}: NEW → ${target} ` +
                        `(score=${lead.lead_score}, confidence=${lead.confidence_score ?? 'n/a'})`,
                );
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ${progress} [ERROR] lead #${leadId}: ${msg}`);
            enrichReport.errors += 1;
        }
    }

    console.log(
        `[POST-SYNC] Completato: cleaned=${enrichReport.dataCleaned} enriched=${enrichReport.enriched} scored=${enrichReport.scored} promoted=${enrichReport.promoted} errors=${enrichReport.errors}`,
    );

    // 5. Cloud sync → Supabase (non-bloccante: errori loggati ma non propagati)
    if (config.supabaseSyncEnabled) {
        console.log(`[CLOUD-SYNC] Push ${total} lead verso Supabase...`);
        const cloudLeads: CloudLeadUpsert[] = [];
        try {
            for (const leadId of leadIds) {
                const lead = await getLeadById(leadId);
                if (!lead) continue;
                // GDPR anti-reintroduzione (goal gdpr-erasure-cloud T4): un lead anonimizzato
                // (linkedin_url riscritto ad 'anon:<sha256>' da runRightToErasure/anonymizeLead)
                // NON deve essere ri-upsertato al cloud — altrimenti l'erasure locale viene
                // vanificato dal primo up-sync che lo reincontra in una lista.
                if (lead.linkedin_url?.startsWith('anon:')) continue;
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
                const synced = await batchUpsertCloudLeads(cloudLeads);
                enrichReport.cloudSynced = synced; // conteggio REALE (non length): no-client e chunk falliti esclusi
                if (synced < cloudLeads.length) {
                    enrichReport.cloudErrors += 1;
                    console.warn(
                        `  [CLOUD] Solo ${synced}/${cloudLeads.length} lead sincronizzati su Supabase (client assente o chunk falliti).`,
                    );
                } else {
                    console.log(`  [CLOUD] ${synced} lead sincronizzati su Supabase.`);
                }
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
            // Outbox fallback: salva i lead per retry via sync worker
            try {
                for (const lead of cloudLeads) {
                    await pushOutboxEvent(
                        'cloud.lead.upsert',
                        { lead, error: msg },
                        `cloud.lead.upsert:${lead.linkedin_url}:${Date.now()}`,
                    );
                }
                console.log(`  [CLOUD-SYNC] ${cloudLeads.length} lead salvati in outbox per retry.`);
            } catch (outboxErr) {
                // A04: outbox push fallito — lead cloud sync persi per questo batch
                console.warn(
                    `[A04] Outbox push failed: ${outboxErr instanceof Error ? outboxErr.message : String(outboxErr)}`,
                );
            }
        }
    }

    return enrichReport;
}

// ── G5-F3 Tier1: setup estratto da runSalesNavigatorListSync (split god-function) ──────────
// Helper con contratto esplicito e zero stato condiviso: ricevono ciò che usano, ritornano ciò
// che producono. Comportamento INVARIATO (move-only, zero-Q regression-safe).

export interface ResolvedSyncTarget {
    /** URL http(s) valido da navigare direttamente; null se l'input non era un URL. */
    explicitListUrl: string | null;
    /** Filtro-nome sulle liste scoperte (anche quando l'utente digita un nome nel campo URL). */
    listFilter: string | null;
    maxPages: number;
    maxLeadsPerList: number;
}

// export: characterization test (G4-parte2, salesNavSyncSplit.vitest.ts)
export function resolveSyncTarget(options: SalesNavigatorSyncOptions): ResolvedSyncTarget {
    const rawListUrl = cleanText(options.listUrl) || null;
    // Robustezza: SOLO un URL http(s) valido può finire in page.goto. Se nel campo URL arriva un
    // valore non-URL (es. l'utente ha digitato il NOME della lista nel prompt URL) NON ci si naviga
    // sopra — causava "page.goto: Invalid url" e crash dell'intero sync. Lo si usa invece come
    // filtro-nome sulle liste scoperte live.
    const explicitListUrl = rawListUrl && /^https?:\/\//i.test(rawListUrl) ? rawListUrl : null;
    if (rawListUrl && !explicitListUrl) {
        console.warn(
            `[SYNC] "${rawListUrl}" non è un URL valido — lo uso come filtro-nome della lista, non come URL di navigazione.`,
        );
    }
    const listFilter = cleanText(options.listName) || (rawListUrl && !explicitListUrl ? rawListUrl : '') || null;
    return {
        explicitListUrl,
        listFilter,
        maxPages: Math.max(1, options.maxPages),
        maxLeadsPerList: Math.max(1, options.maxLeadsPerList),
    };
}

function initSalesNavigatorSyncReport(
    accountId: string,
    dryRun: boolean,
    target: ResolvedSyncTarget,
): SalesNavigatorSyncReport {
    return {
        accountId,
        dryRun,
        listFilter: target.listFilter,
        listDiscoveryCount: 0,
        maxPages: target.maxPages,
        maxLeadsPerList: target.maxLeadsPerList,
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
        enrichment: {
            leadsProcessed: 0,
            dataCleaned: 0,
            scored: 0,
            enriched: 0,
            promoted: 0,
            errors: 0,
            cloudSynced: 0,
            cloudErrors: 0,
        },
        dbBefore: null,
        dbAfter: null,
        durationMs: 0,
    };
}

async function launchOrReuseSession(
    options: SalesNavigatorSyncOptions,
    account: ReturnType<typeof getAccountProfileById>,
    interactive: boolean,
    noProxy: boolean,
): Promise<{ session: BrowserSession; ownsBrowser: boolean }> {
    // Se una sessione esistente è fornita dall'esterno, riusala (evita doppio browser)
    const ownsBrowser = !options.existingSession;
    const session =
        options.existingSession ??
        (await launchBrowser({
            headless: interactive ? false : config.headless,
            sessionDir: account.sessionDir,
            proxy: noProxy ? undefined : account.proxy,
            bypassProxy: noProxy,
            forceDesktop: true,
        }));
    return { session, ownsBrowser };
}

/** Verifica login; su cookie scaduti con utente al terminale attende il login manuale. Throw se non autenticato. */
async function ensureLoggedInOrAwaitManual(
    session: BrowserSession,
    accountId: string,
    interactive: boolean,
): Promise<void> {
    let loggedIn = await checkLogin(session.page);
    if (!loggedIn) {
        // Cookie scaduti: se c'è un utente davanti al terminale, aspetta il login manuale.
        // Non serve il flag --interactive — basta che sia un TTY.
        const { isInteractiveTTY } = await import('../cli/stdinHelper');
        if (interactive || isInteractiveTTY()) {
            const currentUrl = session.page.url().toLowerCase();
            if (!currentUrl.includes('/login')) {
                await session.page
                    .goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 15_000 })
                    .catch(() => null);
            }
            console.log('\n  [LOGIN] Cookie scaduti. Fai login nel browser — hai 5 minuti.\n');
            loggedIn = await awaitManualLogin(session.page, 'salesnav-sync', { timeoutMs: 5 * 60 * 1000 });
        }
    }
    if (!loggedIn) {
        throw new Error(`Sales Navigator sync: sessione non autenticata (account=${accountId}).`);
    }
}

async function applyWarmupAndInputBlock(session: BrowserSession, accountId: string, interactive: boolean): Promise<void> {
    // Warmup sessione: simula navigazione umana (feed, notifiche) prima di operare su SalesNav.
    // Un utente reale non apre LinkedIn e va dritto su una lista SalesNav.
    if (!interactive) {
        try {
            const { warmupSession } = await import('./sessionWarmer');
            const lastSessionEndedAt = await getRuntimeFlag(`browser_session_ended_at:${accountId}`).catch(
                () => null,
            );
            await warmupSession(session.page, lastSessionEndedAt);
        } catch (warmupErr) {
            console.warn(
                `[WARN] Warmup fallito: ${warmupErr instanceof Error ? warmupErr.message : String(warmupErr)}`,
            );
        }
    }

    // blockUserInput solo in modalità automatica — in interactive l'utente deve poter usare il mouse
    if (!interactive) {
        enableWindowClickThrough(session.browser);
        await blockUserInput(session.page);
    }
    if (interactive) {
        console.log('[OK] Login rilevato. Avvio sync lista (mouse libero)...');
    }
}

/**
 * Carica il checkpoint liste-completate. Salva i NOMI delle liste (4.1 fix), non l'indice
 * numerico che è fragile se le liste cambiano ordine/quantità. Checkpoint corrotto → riparte
 * da zero con warning (mai crash).
 */
// export: characterization test (G4-parte2)
export async function restoreListCheckpoint(
    accountId: string,
    listName: string | null | undefined,
): Promise<{ checkpointKey: string; completedListNames: Set<string> }> {
    const checkpointKey = `sync_list_checkpoint:${accountId}:${listName ?? 'all'}`;
    const lastCheckpointRaw = await getRuntimeFlag(checkpointKey).catch(() => null);
    let completedListNames: Set<string>;
    try {
        const parsed = lastCheckpointRaw ? JSON.parse(lastCheckpointRaw) : [];
        completedListNames = new Set<string>(Array.isArray(parsed) ? (parsed as string[]) : []);
    } catch (parseErr) {
        console.warn(
            `[SYNC] Checkpoint corrotto (${checkpointKey}) — riparto da zero: ${
                parseErr instanceof Error ? parseErr.message : String(parseErr)
            }`,
        );
        completedListNames = new Set<string>();
    }
    return { checkpointKey, completedListNames };
}

/**
 * Teardown del browser di proprietà del sync: disable click-through PRIMA di close (pattern
 * canonico jobRunner/syncSearchService — senza, il click-through resta orfano: PID nel set +
 * timer attivo + mouse utente bloccato in scenari loop/daemon) + flag `browser_session_ended_at`.
 */
async function closeOwnedBrowser(session: BrowserSession, accountId: string): Promise<void> {
    disableWindowClickThrough(session.browser);
    await closeBrowser(session);
    await setRuntimeFlag(`browser_session_ended_at:${accountId}`, new Date().toISOString()).catch(() => null);
}

/** Snapshot DB post-sync + durata totale nel report (best-effort, mai blocca il return). */
async function capturePostSyncMetrics(report: SalesNavigatorSyncReport, startTime: number): Promise<void> {
    report.dbAfter = await takeDbSnapshot().catch(() => null);
    report.durationMs = Date.now() - startTime;
}

// ── G5-F3 Tier2: discovery + enrichment estratti dal core di runSalesNavigatorListSync ─────

/**
 * Scopre le liste salvate SalesNav e applica il filtro nome (o usa l'URL esplicito senza
 * navigare la pagina liste). Gestisce la sessione SalesNav scaduta (SALESNAV_LOGIN_REQUIRED)
 * con UN retry dopo login manuale. Throw se nessuna lista corrisponde al filtro, con hint dei
 * nomi scoperti (evita una seconda navigazione diagnostica).
 */
async function discoverAndFilterLists(
    session: BrowserSession,
    explicitListUrl: string | null,
    listFilter: string | null,
    interactive: boolean,
): Promise<{ targetLists: SalesNavSavedList[]; listDiscoveryCount: number }> {
    if (explicitListUrl) {
        return {
            targetLists: [
                {
                    name: listFilter || 'default',
                    url: explicitListUrl,
                },
            ],
            listDiscoveryCount: 0,
        };
    }

    let discovered: SalesNavSavedList[];
    try {
        discovered = await navigateToSavedLists(session.page);
    } catch (navErr) {
        const isSalesNavLogin = navErr instanceof Error && navErr.message.includes('SALESNAV_LOGIN_REQUIRED');
        if (!isSalesNavLogin) throw navErr;

        // Sessione SalesNav scaduta — disabilita click-through per login manuale
        console.warn('[SYNC] Sessione SalesNav scaduta — in attesa del login manuale...');
        if (!interactive) disableWindowClickThrough(session.browser);
        const relogged = await awaitManualLogin(session.page, 'salesnav-list-sync', {
            timeoutMs: 3 * 60 * 1000,
        });
        if (!relogged) throw navErr;
        if (!interactive) {
            enableWindowClickThrough(session.browser);
            await blockUserInput(session.page);
        }
        // Retry dopo login manuale
        discovered = await navigateToSavedLists(session.page);
    }
    // Re-inject overlay dopo navigazione (il DOM viene distrutto da page.goto)
    if (!interactive) await blockUserInput(session.page);

    const allDiscoveredNames = discovered.map((l) => l.name);
    const targetLists = listFilter ? discovered.filter((entry) => matchesListNameFilter(entry, listFilter)) : discovered;

    if (targetLists.length === 0) {
        // Riusa i nomi già scoperti — evita una seconda navigazione alla pagina liste
        const hint =
            allDiscoveredNames.length > 0
                ? ` Liste trovate: [${allDiscoveredNames.join(', ')}]. Usa --list "NOME" o --url <url>.`
                : ' Nessuna lista trovata nella pagina SalesNav.';
        throw new Error(
            `Sales Navigator sync: nessuna lista corrisponde al filtro "${listFilter || '(nessuno)'}".${hint}`,
        );
    }

    return { targetLists, listDiscoveryCount: discovered.length };
}

/**
 * Enrichment offline post-sync (nessun browser): dedup cross-lista (un lead presente in 2+
 * liste viene arricchito una sola volta), raggruppa per lista e somma i risultati di
 * postSyncEnrichment. Ritorna i totali aggregati; NON muta il report (contratto esplicito).
 */
async function orchestrateEnrichmentByList(
    allSyncedLeadIds: Array<{ id: number; listName: string }>,
    dryRun: boolean,
): Promise<SalesNavigatorSyncReport['enrichment']> {
    const totals: SalesNavigatorSyncReport['enrichment'] = {
        leadsProcessed: 0,
        dataCleaned: 0,
        scored: 0,
        enriched: 0,
        promoted: 0,
        errors: 0,
        cloudSynced: 0,
        cloudErrors: 0,
    };

    // Dedup: un lead che appare in 2+ liste viene arricchito una sola volta
    const seenLeadIds = new Set<number>();
    const uniqueSyncedLeads = allSyncedLeadIds.filter((entry) => {
        if (seenLeadIds.has(entry.id)) return false;
        seenLeadIds.add(entry.id);
        return true;
    });
    const byList = new Map<string, number[]>();
    for (const entry of uniqueSyncedLeads) {
        const arr = byList.get(entry.listName) ?? [];
        arr.push(entry.id);
        byList.set(entry.listName, arr);
    }
    for (const [ln, ids] of byList) {
        const enrichResult = await postSyncEnrichment(ids, ln, dryRun);
        totals.leadsProcessed += enrichResult.leadsProcessed;
        totals.dataCleaned += enrichResult.dataCleaned;
        totals.scored += enrichResult.scored;
        totals.enriched += enrichResult.enriched;
        totals.promoted += enrichResult.promoted;
        totals.errors += enrichResult.errors;
        totals.cloudSynced += enrichResult.cloudSynced;
        totals.cloudErrors += enrichResult.cloudErrors;
    }
    return totals;
}

/**
 * Upsert in DB di un batch di candidati scrapati da una lista. Muta SOLO `listReport`
 * (samples + contatori — contratto dichiarato, unit-testabile con mock DB); ritorna gli id
 * dei lead sincronizzati (>0). In dryRun conta would-insert/would-update senza scrivere.
 */
// export: characterization test (G4-parte2)
export async function upsertLeadBatch(
    candidates: SalesNavLeadCandidate[],
    listRow: Awaited<ReturnType<typeof upsertSalesNavList>> | null,
    listName: string,
    dryRun: boolean,
    listReport: SalesNavigatorSyncListReport,
): Promise<number[]> {
    const syncedLeadIds: number[] = [];
    for (const candidate of candidates) {
        if (listReport.samples.length < 10) {
            listReport.samples.push(toSample(candidate));
        }
        try {
            if (dryRun) {
                const existing = await getLeadByLinkedinUrl(candidate.linkedinUrl);
                if (existing) {
                    listReport.wouldUpdate += 1;
                } else {
                    listReport.wouldInsert += 1;
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
            } else if (upserted.action === 'updated') {
                listReport.updated += 1;
            } else {
                listReport.unchanged += 1;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[SYNC] Errore upsert lead ${candidate.linkedinUrl}: ${msg}`);
            listReport.errors += 1;
        }
    }
    // Live enrichment (post-scraping): salvati lead reali → arricchisci in background i mancanti
    // (parallelo, solo fonti gratuite). Fire-and-forget, non blocca il sync, mai in dry-run.
    if (!dryRun && syncedLeadIds.length > 0) {
        triggerLiveEnrichment(listName);
    }
    return syncedLeadIds;
}

export interface SingleListSyncOutcome {
    listReport: SalesNavigatorSyncListReport;
    syncedLeadIds: number[];
    /** true = challenge NON risolto: il caller deve fermare il loop liste (già notificato). */
    challengeAborted: boolean;
    /** true = scrape degradato: il caller NON deve avanzare il checkpoint (lista da ri-tentare). */
    scrapeDegraded: boolean;
}

/**
 * Sincronizza UNA lista SalesNav: scrape (con retry su sessione SalesNav scaduta), challenge
 * check, upsert batch, marcatura synced (solo scrape sano). NON muta il report aggregato né il
 * checkpoint: l'aggregazione resta al caller (contratto esplicito, zero stato condiviso).
 */
// export: characterization test (G4-parte2)
export async function processSingleListSync(
    session: BrowserSession,
    accountId: string,
    targetList: SalesNavSavedList,
    limits: ResolvedSyncTarget,
    dryRun: boolean,
    interactive: boolean,
): Promise<SingleListSyncOutcome> {
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

    let scraped: Awaited<ReturnType<typeof scrapeLeadsFromSalesNavList>>;
    try {
        scraped = await scrapeLeadsFromSalesNavList(session.page, {
            listUrl,
            maxPages: limits.maxPages,
            leadLimit: limits.maxLeadsPerList,
            interactive,
        });
    } catch (scrapeErr) {
        const isSalesNavLogin = scrapeErr instanceof Error && scrapeErr.message.includes('SALESNAV_LOGIN_REQUIRED');
        if (!isSalesNavLogin) throw scrapeErr;

        // Sessione SalesNav scaduta durante scraping lista — attendi login manuale
        console.warn(`[SYNC] Sessione SalesNav scaduta su lista "${listName}" — in attesa del login manuale...`);
        if (!interactive) disableWindowClickThrough(session.browser);
        const relogged = await awaitManualLogin(session.page, 'salesnav-list-scrape', {
            timeoutMs: 3 * 60 * 1000,
        });
        if (!relogged) throw scrapeErr;
        if (!interactive) {
            enableWindowClickThrough(session.browser);
            await blockUserInput(session.page);
        }
        // Retry dopo login manuale
        scraped = await scrapeLeadsFromSalesNavList(session.page, {
            listUrl,
            maxPages: limits.maxPages,
            leadLimit: limits.maxLeadsPerList,
            interactive,
        });
    }
    listReport.pagesVisited = scraped.pagesVisited;
    listReport.candidatesDiscovered = scraped.candidatesDiscovered;
    listReport.uniqueCandidates = scraped.uniqueCandidates;

    if (await detectChallenge(session.page)) {
        const resolved = await attemptChallengeResolution(session.page).catch(() => false);
        if (!resolved) {
            await handleChallengeDetected({
                source: 'salesnav_sync',
                accountId,
                linkedinUrl: listUrl,
                message: 'Challenge rilevato durante sincronizzazione Sales Navigator',
                extra: {
                    listName,
                    listUrl,
                },
            });
            return { listReport, syncedLeadIds: [], challengeAborted: true, scrapeDegraded: false };
        }
        await humanDelay(session.page, 1500, 3000);
    }

    const listRow = dryRun ? null : await upsertSalesNavList(listName, listUrl);
    const syncedLeadIds = await upsertLeadBatch(scraped.leads, listRow, listName, dryRun, listReport);

    if (scraped.scrapeDegraded) {
        // Scrape fallito (probabile cambio DOM LinkedIn): NON marcare synced né avanzare il
        // checkpoint, altrimenti la lista verrebbe saltata per SEMPRE nei run futuri. Conta come
        // errore → success=false + alert, e la lista viene ri-tentata al prossimo run.
        listReport.errors += 1;
        console.warn(
            `[SYNC] Lista "${listName}" NON marcata synced: scrape degradato (0 lead, nessun indicatore di lista-vuota).`,
        );
    } else if (listRow && !dryRun) {
        await markSalesNavListSynced(listRow.id);
    }

    return { listReport, syncedLeadIds, challengeAborted: false, scrapeDegraded: scraped.scrapeDegraded };
}

export async function runSalesNavigatorListSync(options: SalesNavigatorSyncOptions): Promise<SalesNavigatorSyncReport> {
    const target = resolveSyncTarget(options);
    const { explicitListUrl, listFilter } = target;
    const account = getAccountProfileById(options.accountId);

    const report = initSalesNavigatorSyncReport(account.id, options.dryRun, target);

    const startTime = Date.now();
    report.dbBefore = await takeDbSnapshot().catch(() => null);

    const interactive = options.interactive === true;
    const noProxy = options.noProxy === true;
    const { session, ownsBrowser } = await launchOrReuseSession(options, account, interactive, noProxy);

    let browserClosed = false;
    const allSyncedLeadIds: Array<{ id: number; listName: string }> = [];

    try {
        await ensureLoggedInOrAwaitManual(session, account.id, interactive);
        await applyWarmupAndInputBlock(session, account.id, interactive);

        const discovery = await discoverAndFilterLists(session, explicitListUrl, listFilter, interactive);
        const targetLists = discovery.targetLists;
        report.listDiscoveryCount = discovery.listDiscoveryCount;

        // Checkpoint/Resume: nomi liste già completate (vedi restoreListCheckpoint).
        const { checkpointKey, completedListNames } = await restoreListCheckpoint(account.id, options.listName);

        for (const targetList of targetLists) {
            // Skip liste già completate nel run precedente (stessa normalizzazione del listReport)
            const listName = cleanText(targetList.name) || 'default';
            if (completedListNames.has(listName)) continue;

            const outcome = await processSingleListSync(
                session,
                account.id,
                targetList,
                target,
                options.dryRun,
                interactive,
            );

            // Aggregazione nel report globale (era inline nel loop pre-split: i totali finali
            // sono identici — su throw il report non è comunque osservabile).
            report.pagesVisited += outcome.listReport.pagesVisited;
            report.candidatesDiscovered += outcome.listReport.candidatesDiscovered;
            report.uniqueCandidates += outcome.listReport.uniqueCandidates;
            report.inserted += outcome.listReport.inserted;
            report.updated += outcome.listReport.updated;
            report.unchanged += outcome.listReport.unchanged;
            report.wouldInsert += outcome.listReport.wouldInsert;
            report.wouldUpdate += outcome.listReport.wouldUpdate;
            report.errors += outcome.listReport.errors;
            report.lists.push(outcome.listReport);

            if (outcome.challengeAborted) {
                report.challengeDetected = true;
                break;
            }

            allSyncedLeadIds.push(...outcome.syncedLeadIds.map((id) => ({ id, listName })));

            // Checkpoint (4.1 fix): persisti nomi liste completate — SOLO se lo scrape non è degradato,
            // così una lista con scrape fallito resta fuori dal checkpoint e viene ri-tentata.
            if (!options.dryRun && !outcome.scrapeDegraded) {
                completedListNames.add(listName);
                await setRuntimeFlag(checkpointKey, JSON.stringify([...completedListNames])).catch(() => null);
            }
        }

        // Reset checkpoint al termine del sync completo (tutte le liste processate)
        if (!options.dryRun && completedListNames.size >= targetLists.length) {
            await setRuntimeFlag(checkpointKey, '[]').catch(() => null);
        }

        // Chiudi browser SUBITO dopo scraping (non serve piu per enrichment)
        if (ownsBrowser) {
            await closeOwnedBrowser(session, account.id);
            browserClosed = true;
        }

        if (options.skipEnrichment) {
            console.log('[OK] Browser chiuso. Enrichment saltato (--no-enrich).');
        } else {
            console.log('[OK] Browser chiuso. Avvio enrichment offline...');
            // report.enrichment parte azzerato da initSalesNavigatorSyncReport: l'assegnazione
            // diretta dei totali equivale alla somma in-place del codice pre-split.
            report.enrichment = await orchestrateEnrichmentByList(allSyncedLeadIds, options.dryRun);
        }

        await capturePostSyncMetrics(report, startTime);
        return report;
    } finally {
        if (ownsBrowser && !browserClosed) {
            await closeOwnedBrowser(session, account.id);
        }
    }
}
