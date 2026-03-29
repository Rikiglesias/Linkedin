/**
 * utilCommands.ts — Comandi CLI di utilità
 *
 * import, login, funnel, site-check, state-sync, proxy-status,
 * random-activity, enrich-targets, enrich-deep, create-profile, workflow-run
 */

import { config } from '../../config';
import { maskEmail, maskPhone } from '../../security/redaction';
import {
    launchBrowser,
    closeBrowser as closeBrowserSession,
    checkLogin,
    isLoggedIn,
    detectChallenge,
} from '../../browser';
import { importLeadsFromCSV } from '../../csvImporter';
import { buildFunnelReport, runSiteCheck } from '../../core/audit';
import { runCompanyEnrichmentBatch } from '../../core/companyEnrichment';
import { getLeadById, upsertLeadEnrichmentData } from '../../core/repositories';
import { findPersonData, type PersonDataResult } from '../../integrations/personDataFinder';
import { syncEnrichmentDataToCloud, updateCloudLeadStatus } from '../../cloud/supabaseDataClient';
import { getDatabase } from '../../db';
import type { LeadRecord } from '../../types/domain';
import { runRandomLinkedinActivity } from '../../workers/randomActivityWorker';
import { createPersistentProfile, resolveProfileDir } from '../../scripts/createProfile';
import { getAccountProfileById, getRuntimeAccountProfiles } from '../../accountManager';
import {
    checkProxyHealth,
    getIntegrationProxyFailoverChain,
    getIntegrationProxyPoolStatus,
    getProxyFailoverChain,
    getProxyPoolStatus,
} from '../../proxyManager';
import { getOptionValue, hasOption, parseIntStrict, getPositionalArgs } from '../cliParser';

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function runImportCommand(args: string[]): Promise<void> {
    const legacyPath = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
    const filePath = getOptionValue(args, '--file') ?? legacyPath;
    const listName = getOptionValue(args, '--list') ?? 'default';

    if (!filePath) {
        throw new Error('Specifica il CSV: npm start -- import --file path/to/file.csv --list nome_lista');
    }

    const result = await importLeadsFromCSV(filePath, listName);
    console.log(
        `Import completato. Lead inseriti = ${result.inserted}, Company target inseriti = ${result.companyTargetsInserted}, Skippati = ${result.skipped}, Errori = ${result.errors}, Lista = ${listName}`,
    );
}

export async function runLoginCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const positionalTimeout = positional.find((value) => /^\d+$/.test(value));
    const positionalAccount = positional.find((value) => !/^\d+$/.test(value));
    const timeoutRaw = getOptionValue(args, '--timeout') ?? positionalTimeout;
    const timeoutSeconds = timeoutRaw ? Math.max(30, parseIntStrict(timeoutRaw, '--timeout')) : 300;
    const timeoutMs = timeoutSeconds * 1000;
    const accountRaw = getOptionValue(args, '--account') ?? positionalAccount;
    const selectedAccount = getAccountProfileById(accountRaw);
    const availableAccounts = getRuntimeAccountProfiles().map((account) => account.id);
    if (accountRaw && accountRaw !== selectedAccount.id) {
        console.warn(
            `[LOGIN] account = ${accountRaw} non trovato.Uso account = ${selectedAccount.id}.Disponibili: ${availableAccounts.join(', ')} `,
        );
    }

    const noProxy = args.includes('--no-proxy');
    const session = await launchBrowser({
        headless: false,
        sessionDir: selectedAccount.sessionDir,
        proxy: noProxy ? undefined : selectedAccount.proxy,
        bypassProxy: noProxy,
        forceDesktop: true,
    });
    try {
        await session.page.goto('https://www.linkedin.com/login', { waitUntil: 'load' });
        console.log(
            `Completa il login LinkedIn nella finestra aperta(account = ${selectedAccount.id}, timeout ${timeoutSeconds}s)...`,
        );
        console.log('Il browser resta aperto finché il login non viene verificato o finché scade il timeout.');

        const startedAt = Date.now();
        let lastLogAt = 0;
        while (Date.now() - startedAt <= timeoutMs) {
            if (await isLoggedIn(session.page)) {
                const confirmed = await checkLogin(session.page);
                if (confirmed) {
                    console.log('Login sessione completato con successo.');
                    return;
                }
            }
            const now = Date.now();
            if (now - lastLogAt >= 15_000) {
                const remaining = Math.max(0, Math.ceil((timeoutMs - (now - startedAt)) / 1000));
                console.log(`In attesa completamento login... (${remaining}s rimanenti)`);
                lastLogAt = now;
            }
            await session.page.waitForTimeout(2500);
        }

        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            throw new Error(`Login non rilevato entro ${timeoutSeconds} secondi.`);
        }
        console.log('Login sessione completato con successo.');
    } finally {
        await closeBrowserSession(session);
    }
}

export async function runFunnelCommand(): Promise<void> {
    const report = await buildFunnelReport();
    console.log(JSON.stringify(report, null, 2));
}

export async function runSiteCheckCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 25;
    const autoFix = hasOption(args, '--fix') || positional.includes('fix');
    const report = await runSiteCheck({ limitPerStatus: limit, autoFix });
    console.log(JSON.stringify(report, null, 2));
}

export async function runStateSyncCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : config.postRunStateSyncLimit;
    const autoFix = hasOption(args, '--fix') || positional.includes('fix') || config.postRunStateSyncFix;
    const report = await runSiteCheck({ limitPerStatus: limit, autoFix });
    console.log(
        JSON.stringify(
            {
                mode: 'state_sync',
                limitPerStatus: limit,
                autoFix,
                report,
            },
            null,
            2,
        ),
    );
}

export async function runProxyStatusCommand(): Promise<void> {
    const sessionStatus = getProxyPoolStatus();
    const integrationStatus = getIntegrationProxyPoolStatus();
    const sessionFailoverChain = getProxyFailoverChain().map((proxy, index) => ({
        order: index + 1,
        server: proxy.server,
        type: proxy.type ?? 'unknown',
        auth: !!proxy.username || !!proxy.password,
    }));
    const integrationFailoverChain = getIntegrationProxyFailoverChain().map((proxy, index) => ({
        order: index + 1,
        server: proxy.server,
        type: proxy.type ?? 'unknown',
        auth: !!proxy.username || !!proxy.password,
    }));

    console.log(
        JSON.stringify(
            {
                integrationProxyPoolEnabled: config.integrationProxyPoolEnabled,
                session: {
                    ...sessionStatus,
                    failoverChain: sessionFailoverChain,
                },
                integration: {
                    ...integrationStatus,
                    failoverChain: integrationFailoverChain,
                },
            },
            null,
            2,
        ),
    );
}

export async function runRandomActivityCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const maxActionsRaw =
        getOptionValue(args, '--max-actions') ??
        getOptionValue(args, '--actions') ??
        positional.find((value) => /^\d+$/.test(value));
    const accountId =
        getOptionValue(args, '--account') ??
        positional.find((value) => {
            const normalized = value.toLowerCase();
            if (normalized === 'dry' || normalized === 'dry-run') return false;
            return !value.startsWith('--') && !/^\d+$/.test(value);
        }) ??
        config.salesNavSyncAccountId ??
        undefined;
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry') || positional.includes('dry-run');
    const maxActions = maxActionsRaw
        ? Math.max(1, parseIntStrict(maxActionsRaw, '--max-actions'))
        : config.randomActivityMaxActions;

    const report = await runRandomLinkedinActivity({
        accountId: accountId || undefined,
        maxActions,
        dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
}

export async function runEnrichTargetsCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : config.companyEnrichmentBatch;
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry') || positional.includes('dry-run');
    const report = await runCompanyEnrichmentBatch({
        limit,
        maxProfilesPerCompany: config.companyEnrichmentMaxProfilesPerCompany,
        dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
}

// ─── Deep Enrichment ─────────────────────────────────────────────────────────

function inferDomainFromLead(lead: LeadRecord): string {
    const raw = (lead.website ?? '').trim();
    if (raw) {
        try {
            const parsed = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`);
            return parsed.hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
            /* ignore */
        }
    }
    const company = ((lead.account_name as string) ?? '').trim();
    if (company) {
        const slug = company
            .toLowerCase()
            .replace(/\b(srl|spa|inc|ltd|corp|group|italia|italy)\b/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
        return slug ? `${slug}.com` : '';
    }
    return '';
}

async function saveDeepEnrichment(leadId: number, result: PersonDataResult): Promise<void> {
    // Save extended data in lead_enrichment_data
    await upsertLeadEnrichmentData({
        leadId,
        companyJson: result.company ? JSON.stringify(result.company) : null,
        phonesJson: result.phones.length > 0 ? JSON.stringify(result.phones) : null,
        socialsJson: result.socialProfiles.length > 0 ? JSON.stringify(result.socialProfiles) : null,
        seniority: result.seniority,
        department: result.department,
        dataPoints: result.dataPoints,
        confidence: result.overallConfidence,
        sourcesJson: result.sources.length > 0 ? JSON.stringify(result.sources) : null,
    });

    // Update phone + email on leads table (COALESCE = non-destructive)
    const bestPhone = result.phones[0]?.number;
    const bestEmail = result.emails.find((e) => e.source !== 'existing_db')?.address;
    const sets: string[] = [];
    const params: unknown[] = [];

    if (bestPhone) {
        sets.push("phone = COALESCE(NULLIF(phone, ''), ?)");
        params.push(bestPhone);
    }
    if (bestEmail) {
        sets.push("email = COALESCE(NULLIF(email, ''), ?)");
        params.push(bestEmail);
    }
    if (result.overallConfidence > 0) {
        sets.push('confidence_score = COALESCE(confidence_score, ?)');
        params.push(result.overallConfidence);
    }

    if (sets.length > 0) {
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(leadId);
        const db = await getDatabase();
        await db.run(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, params);

        // Push updated fields to cloud leads table
        const lead = await getLeadById(leadId);
        if (lead?.linkedin_url) {
            const cloudPatch: Record<string, unknown> = {};
            if (bestPhone) cloudPatch.phone = lead.phone || bestPhone;
            if (bestEmail) cloudPatch.email = lead.email || bestEmail;
            if (result.overallConfidence > 0) cloudPatch.confidence_score = result.overallConfidence;
            void updateCloudLeadStatus(lead.linkedin_url, lead.status ?? 'NEW', cloudPatch);
        }
    }
}

/**
 * `enrich-deep` — Deep OSINT enrichment via Person Data Finder.
 *
 * Usage:
 *   enrich-deep <leadId>               — Singolo lead
 *   enrich-deep --list <listName>       — Tutti i lead di una lista
 *   enrich-deep --limit 10             — Max lead da processare (default: 25)
 *   enrich-deep --dry-run              — Solo report, niente salvataggio
 */
export async function runEnrichDeepCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const leadIdRaw = getOptionValue(args, '--lead') ?? positional[0];
    const listName = getOptionValue(args, '--list');
    const limitRaw = getOptionValue(args, '--limit');
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 25;
    const dryRun = hasOption(args, '--dry-run');

    const leads: LeadRecord[] = [];

    if (leadIdRaw && !listName) {
        // Single lead mode
        const leadId = parseIntStrict(leadIdRaw, 'leadId');
        const lead = await getLeadById(leadId);
        if (!lead) {
            console.error(`Lead ${leadId} non trovato.`);
            process.exitCode = 1;
            return;
        }
        leads.push(lead);
    } else if (listName) {
        // List mode
        const db = await getDatabase();
        const rows = await db.query<LeadRecord>(
            `SELECT * FROM leads WHERE list_name = ? ORDER BY created_at ASC LIMIT ?`,
            [listName, limit],
        );
        leads.push(...rows);
    } else {
        console.error('Specificare --lead <id> o --list <nome>.');
        process.exitCode = 1;
        return;
    }

    console.log(`[ENRICH-DEEP] ${leads.length} lead da processare${dryRun ? ' (DRY RUN)' : ''}...`);

    let enriched = 0;
    let failed = 0;

    for (const lead of leads) {
        const domain = inferDomainFromLead(lead);
        const firstName = (lead.first_name ?? '').trim();
        const lastName = (lead.last_name ?? '').trim();

        if (!firstName) {
            console.log(`  [SKIP] Lead ${lead.id}: nome mancante`);
            continue;
        }

        try {
            const result = await findPersonData({
                firstName,
                lastName,
                domain: domain || undefined,
                companyName: (lead.account_name as string) || undefined,
                existingEmail: lead.email ?? null,
                existingPhone: lead.phone ?? null,
                existingLinkedinUrl: lead.linkedin_url ?? null,
            });

            if (!dryRun && result.dataPoints > 0) {
                await saveDeepEnrichment(lead.id, result);
            }

            console.log(
                `  [OK] Lead ${lead.id} (${firstName} ${lastName}): ` +
                    `${result.dataPoints} data points, confidence ${result.overallConfidence}%, ` +
                    `${result.phones.length} phone(s), ${result.socialProfiles.length} social(s)`,
            );
            enriched++;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.log(`  [ERR] Lead ${lead.id}: ${msg}`);
            failed++;
        }
    }

    console.log(
        `\n[ENRICH-DEEP] Completato: ${enriched} arricchiti, ${failed} errori, ${leads.length - enriched - failed} skippati`,
    );

    // Sync enrichment data to Supabase cloud
    if (!dryRun && enriched > 0) {
        try {
            const db = await getDatabase();
            const synced = await syncEnrichmentDataToCloud(db);
            if (synced > 0) {
                console.log(`[CLOUD] ${synced} enrichment record sincronizzati su Supabase.`);
            }
        } catch (err) {
            console.log(`[CLOUD] Sync fallita (non bloccante): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

/**
 * `enrich-profiles` — Visita pagine SalesNav per scrappare title, company, location
 * poi lancia enrichment pipeline (domain discovery + OSINT + web search).
 *
 * Anti-detection completa: session maturity, decoy burst, randomMouseMove,
 * simulateTabSwitch, overlay dismiss post-navigazione, pacing adattivo.
 *
 * Usage:
 *   enrich-profiles --list <listName>   — Lead di una lista
 *   enrich-profiles --limit 15          — Max lead per sessione (default: 15)
 *   enrich-profiles --dry-run           — Solo report
 */
export async function runEnrichProfilesCommand(args: string[]): Promise<void> {
    const { scrapeSalesNavProfile } = await import('../../browser/linkedinProfileScraper');
    const { enrichLeadAuto } = await import('../../integrations/leadEnricher');
    const { humanDelay, randomMouseMove, simulateHumanReading, performDecoyBurst } = await import('../../browser');
    const { simulateTabSwitch, blockUserInput } = await import('../../browser/humanBehavior');
    const { enableWindowClickThrough, disableWindowClickThrough } = await import('../../browser/windowInputBlock');
    const { dismissKnownOverlays } = await import('../../browser/overlayDismisser');
    const { getSessionMaturity } = await import('../../browser/sessionCookieMonitor');
    const { getSessionHistory } = await import('../../risk/sessionMemory');

    const listName = getOptionValue(args, '--list');
    const limitRaw = getOptionValue(args, '--limit');
    const rawLimit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 15;
    const dryRun = hasOption(args, '--dry-run');
    const accountId = getOptionValue(args, '--account');
    const noProxy = hasOption(args, '--no-proxy');

    if (!listName) {
        console.error('Specificare --list <nome>.');
        process.exitCode = 1;
        return;
    }

    const account = getAccountProfileById(accountId || undefined);

    // ── Session maturity check ──
    // Riduce il budget se l'account è giovane (0-2 giorni = 30%, 2-7 giorni = 60%)
    const maturity = getSessionMaturity(account.sessionDir);
    const maturityFactor = maturity.budgetFactor;
    const limit = Math.max(1, Math.floor(rawLimit * maturityFactor));

    if (maturityFactor < 1) {
        console.log(
            `[ANTI-DETECT] Session maturity: ${maturity.maturity} — budget ridotto a ${Math.round(maturityFactor * 100)}% (${limit} lead)`,
        );
    }

    // ── Session pacing check ──
    // Se ci sono stati challenge recenti, rallenta il pacing
    const sessionHistory = await getSessionHistory(account.id);
    const pacingFactor = sessionHistory.pacingFactor;
    const basePauseMs = pacingFactor < 0.8 ? 12_000 : pacingFactor < 1.0 ? 8_000 : 6_000;

    if (pacingFactor < 1) {
        console.log(
            `[ANTI-DETECT] Pacing factor: ${pacingFactor.toFixed(2)} — pause piu\' lunghe (${Math.round(basePauseMs / 1000)}s base)`,
        );
    }

    // Query leads missing company/title data
    const db = await getDatabase();
    const leads = await db.query<LeadRecord>(
        `SELECT * FROM leads
         WHERE list_name = ?
           AND linkedin_url LIKE '%/sales/lead/%'
           AND (account_name IS NULL OR TRIM(account_name) = '' OR job_title IS NULL OR TRIM(job_title) = '')
         ORDER BY created_at ASC
         LIMIT ?`,
        [listName, limit],
    );

    if (leads.length === 0) {
        console.log("[ENRICH-PROFILES] Nessun lead da arricchire (tutti hanno gia' company/title).");
        return;
    }

    console.log(`[ENRICH-PROFILES] ${leads.length} lead da visitare su SalesNav${dryRun ? ' (DRY RUN)' : ''}...`);

    if (dryRun) {
        for (const lead of leads) {
            console.log(`  - ${lead.first_name} ${lead.last_name} (id=${lead.id})`);
        }
        return;
    }

    // Launch browser
    const session = await launchBrowser({
        headless: false,
        sessionDir: account.sessionDir,
        proxy: noProxy ? undefined : account.proxy,
        bypassProxy: noProxy,
        forceDesktop: true,
    });

    let scraped = 0;
    let enriched = 0;
    let failed = 0;

    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            console.error('[ERRORE] Sessione non autenticata. Esegui prima "create-profile".');
            return;
        }

        // ── Block user input durante automazione ──
        enableWindowClickThrough(session.browser);
        await blockUserInput(session.page);

        // ── Decoy burst: 2-3 azioni casuali per riscaldare la sessione ──
        console.log("  [ANTI-DETECT] Warm-up con attivita' casuale...");
        await performDecoyBurst(session.page);

        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];
            if (!lead) continue;
            const label = `${lead.first_name} ${lead.last_name}`;
            console.log(`\n  [${i + 1}/${leads.length}] Visitando ${label}...`);

            try {
                // Dismiss overlays PRIMA della navigazione
                await dismissKnownOverlays(session.page);

                // Scrape SalesNav profile page
                const profileData = await scrapeSalesNavProfile(session.page, lead.linkedin_url ?? '');

                // Dismiss overlays DOPO la navigazione (overlay possono apparire post-load)
                await dismissKnownOverlays(session.page);

                if (!profileData) {
                    console.log(`    [SKIP] Nessun dato estratto`);
                    failed++;
                    continue;
                }

                // ── Simula lettura umana del profilo ──
                await simulateHumanReading(session.page);

                scraped++;
                const company = profileData.currentCompany || (lead.account_name as string) || '';
                const title = profileData.currentTitle || (lead.job_title as string) || '';
                const location = profileData.location || '';
                const publicUrl = profileData.publicProfileUrl || '';

                console.log(`    Title: ${title || '-'} | Company: ${company || '-'} | Loc: ${location || '-'}`);
                if (publicUrl) console.log(`    Public URL: ${publicUrl}`);

                // Update local DB with scraped data
                const updates: string[] = [];
                const params: (string | number)[] = [];

                if (company && !(lead.account_name as string)) {
                    updates.push('account_name = ?');
                    params.push(company);
                }
                if (title && !(lead.job_title as string)) {
                    updates.push('job_title = ?');
                    params.push(title);
                }
                if (location && !lead.location) {
                    updates.push('location = ?');
                    params.push(location);
                }
                if (publicUrl) {
                    updates.push('linkedin_url = ?');
                    params.push(publicUrl);
                    if (!lead.salesnav_url) {
                        updates.push('salesnav_url = ?');
                        params.push(lead.linkedin_url ?? '');
                    }
                }

                if (updates.length > 0) {
                    updates.push('updated_at = CURRENT_TIMESTAMP');
                    params.push(lead.id);
                    await db.run(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`, params);
                }

                // Run enrichment pipeline if we now have a company name
                if (company) {
                    try {
                        const enrichResult = await enrichLeadAuto(
                            {
                                id: lead.id,
                                first_name: lead.first_name,
                                last_name: lead.last_name,
                                website: lead.website,
                                account_name: company,
                                linkedin_url: publicUrl || lead.linkedin_url,
                                location,
                            },
                            { deep: true },
                        );

                        if (enrichResult.email || enrichResult.phone || enrichResult.companyDomain) {
                            const eCols: string[] = [];
                            const eParams: (string | number | null)[] = [];
                            if (enrichResult.email) {
                                eCols.push('email = ?');
                                eParams.push(enrichResult.email);
                            }
                            if (enrichResult.phone) {
                                eCols.push('phone = ?');
                                eParams.push(enrichResult.phone);
                            }
                            if (enrichResult.companyDomain) {
                                eCols.push('company_domain = ?');
                                eParams.push(enrichResult.companyDomain);
                            }
                            if (enrichResult.businessEmail) {
                                eCols.push('business_email = ?');
                                eParams.push(enrichResult.businessEmail);
                            }
                            if (enrichResult.businessEmailConfidence > 0) {
                                eCols.push('business_email_confidence = ?');
                                eParams.push(enrichResult.businessEmailConfidence);
                            }
                            if (enrichResult.enrichmentSources) {
                                eCols.push('enrichment_sources = ?');
                                eParams.push(JSON.stringify(enrichResult.enrichmentSources));
                            }
                            if (enrichResult.jobTitle && !title) {
                                eCols.push('job_title = ?');
                                eParams.push(enrichResult.jobTitle);
                            }

                            if (eCols.length > 0) {
                                eCols.push('updated_at = CURRENT_TIMESTAMP');
                                eParams.push(lead.id);
                                await db.run(`UPDATE leads SET ${eCols.join(', ')} WHERE id = ?`, eParams);
                            }

                            enriched++;
                            console.log(
                                `    [ENRICHED] email=${maskEmail(enrichResult.email)} phone=${maskPhone(enrichResult.phone)} domain=${enrichResult.companyDomain || '-'}`,
                            );
                        }
                    } catch (err) {
                        console.log(`    [ENRICH-ERR] ${err instanceof Error ? err.message : String(err)}`);
                    }
                }

                // ── Anti-detection delay tra visite ──
                if (i < leads.length - 1) {
                    const pause = basePauseMs + Math.random() * 8000;
                    console.log(`    Attesa ${Math.round(pause / 1000)}s...`);

                    // 40% probabilita': random mouse move durante la pausa
                    if (Math.random() < 0.4) {
                        await randomMouseMove(session.page);
                    }

                    await humanDelay(session.page, pause, pause + 3000);

                    // 25% probabilita': simula tab switch (focus perso e ripreso)
                    if (Math.random() < 0.25) {
                        await simulateTabSwitch(session.page, 8000 + Math.random() * 12000);
                    }

                    // Ogni 5 profili: decoy action (visita feed/notifiche)
                    if ((i + 1) % 5 === 0 && i < leads.length - 1) {
                        console.log("    [ANTI-DETECT] Pausa con attivita' casuale...");
                        await performDecoyBurst(session.page);
                    }
                }
            } catch (err) {
                console.log(`    [ERR] ${err instanceof Error ? err.message : String(err)}`);
                failed++;
            }
        }

        // ── Rimuovi input block ──
        await session.page
            .evaluate(() => {
                document.querySelector('#__bot_input_block')?.remove();
            })
            .catch(() => null);
    } finally {
        disableWindowClickThrough(session.browser);
        await closeBrowserSession(session);
    }

    console.log(
        `\n[ENRICH-PROFILES] Completato: ${scraped} profili scrappati, ${enriched} arricchiti, ${failed} errori`,
    );

    // Sync to Supabase
    if (enriched > 0 || scraped > 0) {
        try {
            const synced = await syncEnrichmentDataToCloud(db);
            if (synced > 0) {
                console.log(`[CLOUD] ${synced} record sincronizzati su Supabase.`);
            }
        } catch (err) {
            console.log(`[CLOUD] Sync fallita: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

export async function runEnrichFastCommand(args: string[]): Promise<void> {
    const { enrichLeadsParallel } = await import('../../integrations/parallelEnricher');

    const listName = getOptionValue(args, '--list') ?? undefined;
    const limitRaw = getOptionValue(args, '--limit') ?? getPositionalArgs(args)[0];
    const concurrencyRaw = getOptionValue(args, '--concurrency');
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 50;
    const concurrency = concurrencyRaw ? Math.max(1, Math.min(20, parseIntStrict(concurrencyRaw, '--concurrency'))) : 5;

    console.log(
        `[ENRICH-FAST] Avvio enrichment parallelo: limit=${limit}, concurrency=${concurrency}${listName ? `, list=${listName}` : ''}`,
    );
    console.log(`[ENRICH-FAST] Fonti: Domain Discovery + EmailGuesser + PersonDataFinder + WebSearch (zero LinkedIn)`);

    const report = await enrichLeadsParallel({
        listName,
        limit,
        concurrency,
        onProgress: (done, total, lastLead) => {
            const pct = Math.round((done / total) * 100);
            console.log(`  [${done}/${total}] ${pct}% — ${lastLead}`);
        },
    });

    const durationSec = Math.round(report.durationMs / 1000);
    const avgSec = report.total > 0 ? Math.round(report.durationMs / report.total / 1000) : 0;
    console.log(`\n[ENRICH-FAST] Completato in ${durationSec}s (media ${avgSec}s/lead)`);
    console.log(`  Lead processati: ${report.total}`);
    console.log(`  Arricchiti:      ${report.enriched}`);
    console.log(`  Email trovate:   ${report.emailsFound}`);
    console.log(`  Business email:  ${report.businessEmailsFound}`);
    console.log(`  Telefoni:        ${report.phonesFound}`);
    console.log(`  Falliti:         ${report.failed}`);
}

export async function runCreateProfileCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const dirRaw = getOptionValue(args, '--dir') ?? positional[0];
    const timeoutRaw = getOptionValue(args, '--timeout') ?? positional.find((value) => /^\d+$/.test(value));
    const url = getOptionValue(args, '--url') ?? 'https://www.linkedin.com/login';
    const timeoutSeconds = timeoutRaw ? Math.max(60, parseIntStrict(timeoutRaw, '--timeout')) : 900;

    await createPersistentProfile({
        profileDir: resolveProfileDir(dirRaw),
        timeoutSeconds,
        loginUrl: url,
    });
}

export async function runTestConnectionCommand(args: string[]): Promise<void> {
    const accountId = getOptionValue(args, '--account');
    const noProxy = hasOption(args, '--no-proxy');
    const account = getAccountProfileById(accountId || undefined);

    const report: {
        accountId: string;
        proxyConfigured: boolean;
        proxyReachable: boolean | null;
        proxyLatencyMs: number | null;
        browserLaunched: boolean;
        linkedinReachable: boolean;
        linkedinLatencyMs: number | null;
        loggedIn: boolean;
        challengeDetected: boolean;
        currentUrl: string | null;
        errors: string[];
    } = {
        accountId: account.id,
        proxyConfigured: !!account.proxy && !noProxy,
        proxyReachable: null,
        proxyLatencyMs: null,
        browserLaunched: false,
        linkedinReachable: false,
        linkedinLatencyMs: null,
        loggedIn: false,
        challengeDetected: false,
        currentUrl: null,
        errors: [],
    };

    // 1. Proxy health check
    if (account.proxy && !noProxy) {
        const proxyStart = Date.now();
        report.proxyReachable = await checkProxyHealth(account.proxy);
        report.proxyLatencyMs = Date.now() - proxyStart;
        if (!report.proxyReachable) {
            report.errors.push(`Proxy ${account.proxy.server} non raggiungibile`);
        }
    }

    // 2. Browser launch + LinkedIn navigation
    let session: Awaited<ReturnType<typeof launchBrowser>> | null = null;
    try {
        session = await launchBrowser({
            sessionDir: account.sessionDir,
            proxy: noProxy ? undefined : account.proxy,
            bypassProxy: noProxy,
            forceDesktop: true,
        });
        report.browserLaunched = true;

        const navStart = Date.now();
        await session.page.goto('https://www.linkedin.com/feed/', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        report.linkedinLatencyMs = Date.now() - navStart;
        report.linkedinReachable = true;
        report.currentUrl = session.page.url();

        // 3. Login check
        report.loggedIn = await checkLogin(session.page);

        // 4. Challenge detection
        report.challengeDetected = await detectChallenge(session.page);
        if (report.challengeDetected) {
            report.errors.push('Challenge LinkedIn rilevato');
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        report.errors.push(msg);
    } finally {
        if (session) {
            await closeBrowserSession(session).catch(() => {});
        }
    }

    const ok = report.browserLaunched && report.linkedinReachable && report.loggedIn && !report.challengeDetected;
    console.log(JSON.stringify({ ok, ...report }, null, 2));
    if (!ok) {
        process.exitCode = 1;
    }
}
