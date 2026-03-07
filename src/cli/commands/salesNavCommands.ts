/**
 * salesNavCommands.ts — Comandi CLI relativi a Sales Navigator
 */

import { Page } from 'playwright';
import { getAccountProfileById } from '../../accountManager';
import { config } from '../../config';
import {
    launchBrowser,
    closeBrowser as closeBrowserSession,
    checkLogin,
    isLoggedIn,
    enableVisualCursorOverlay,
    humanDelay,
    detectChallenge,
} from '../../browser';
import {
    getLeadById,
    getLeadsWithSalesNavigatorUrls,
    getSalesNavListByName,
    listSalesNavLists,
    linkLeadToSalesNavList,
    upsertSalesNavList,
    updateLeadLinkedinUrl,
} from '../../core/repositories';
import { reconcileLeadStatus } from '../../core/leadStateService';
import { runSalesNavigatorListSync } from '../../core/salesNavigatorSync';
import {
    extractSavedSearches,
    runSalesNavBulkSave,
    SEARCHES_URL,
    type SavedSearchDescriptor,
} from '../../salesnav/bulkSaveOrchestrator';
import { addLeadToSalesNavList, createSalesNavList } from '../../salesnav/listActions';
import { scrapeSavedSearchAndSaveToList, scrapeAllSavedSearchesAndSaveToList } from '../../salesnav/searchExtractor';
import { isProfileUrl, isSalesNavigatorUrl, normalizeLinkedInUrl } from '../../linkedinUrl';
import { getOptionValue, hasOption, parseIntStrict, getPositionalArgs } from '../cliParser';

// ─── Tipi locali ──────────────────────────────────────────────────────────────

interface SalesNavResolveItem {
    leadId: number;
    status: string;
    currentUrl: string;
    resolvedProfileUrl: string | null;
    action: 'resolved' | 'updated' | 'conflict' | 'unresolved' | 'challenge_detected' | 'error';
    conflictLeadId?: number | null;
    error?: string;
}

interface SalesNavResolveReport {
    scanned: number;
    resolvable: number;
    updated: number;
    conflicts: number;
    unresolved: number;
    challengeDetected: boolean;
    fix: boolean;
    dryRun: boolean;
    items: SalesNavResolveItem[];
}

// ─── Helper interni ───────────────────────────────────────────────────────────

async function collectProfileUrlCandidates(page: Page): Promise<string[]> {
    const candidates = new Set<string>();

    const currentUrl = page.url();
    if (currentUrl) candidates.add(currentUrl);

    const canonicalHref = await page
        .locator('link[rel="canonical"]')
        .first()
        .getAttribute('href')
        .catch(() => null);
    if (canonicalHref) candidates.add(canonicalHref);

    const ogUrl = await page
        .locator('meta[property="og:url"]')
        .first()
        .getAttribute('content')
        .catch(() => null);
    if (ogUrl) candidates.add(ogUrl);

    const anchors = await page
        .evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
                .map((node) => (node as HTMLAnchorElement).href)
                .filter((href) => typeof href === 'string' && href.length > 0);
        })
        .catch(() => [] as string[]);

    for (const href of anchors) {
        candidates.add(href);
    }

    return Array.from(candidates);
}

function pickResolvedProfileUrl(candidates: string[]): string | null {
    for (const candidate of candidates) {
        const normalized = normalizeLinkedInUrl(candidate);
        if (!isProfileUrl(normalized)) continue;
        if (isSalesNavigatorUrl(normalized)) continue;
        return normalized;
    }
    return null;
}

function getRecoveryStatusFromBlockedReason(
    reason: string | null,
): 'READY_INVITE' | 'INVITED' | 'READY_MESSAGE' | null {
    const normalized = (reason ?? '').toLowerCase();
    if (normalized.includes('salesnav_url_requires_profile_invite')) {
        return 'READY_INVITE';
    }
    if (normalized.includes('salesnav_url_requires_profile_check')) {
        return 'INVITED';
    }
    if (normalized.includes('salesnav_url_requires_profile_message')) {
        return 'READY_MESSAGE';
    }
    return null;
}

function getNpmConfigOptionValue(name: string): string | undefined {
    const envKey = `npm_config_${name.replace(/-/g, '_')}`;
    const raw = process.env[envKey];
    if (!raw) {
        return undefined;
    }
    const normalized = raw.trim();
    if (!normalized || normalized === 'true' || normalized === 'false') {
        return undefined;
    }
    return normalized;
}

function hasNpmConfigFlag(name: string): boolean {
    const envKey = `npm_config_${name.replace(/-/g, '_')}`;
    const raw = (process.env[envKey] ?? '').trim().toLowerCase();
    return raw === 'true' || raw === '1';
}

async function waitForEnter(): Promise<void> {
    await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', () => resolve());
    });
}

async function readLineFromStdin(prompt: string): Promise<string> {
    return new Promise<string>((resolve) => {
        process.stdout.write(prompt);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        let buffer = '';
        const onData = (chunk: string) => {
            buffer += chunk;
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex !== -1) {
                process.stdin.removeListener('data', onData);
                resolve(buffer.slice(0, newlineIndex).replace(/\r/g, '').trim());
            }
        };
        process.stdin.on('data', onData);
    });
}

async function askUserToChooseSearch(searches: SavedSearchDescriptor[]): Promise<SavedSearchDescriptor> {
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('  RICERCHE SALVATE RILEVATE');
    console.log('────────────────────────────────────────────────────────────');
    searches.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.name}`);
    });
    console.log('────────────────────────────────────────────────────────────\n');

    while (true) {
        const input = await readLineFromStdin(`Scegli ricerca (1-${searches.length}): `);
        const num = parseInt(input, 10);
        if (Number.isFinite(num) && num >= 1 && num <= searches.length) {
            return searches[num - 1];
        }
        // Accept search by name
        const byName = searches.find((s) => s.name.toLowerCase().includes(input.toLowerCase()));
        if (byName) {
            return byName;
        }
        console.log(`  Scelta non valida. Inserisci un numero tra 1 e ${searches.length} oppure parte del nome.`);
    }
}

async function askUserToChooseList(): Promise<string> {
    const lists = await listSalesNavLists(50);

    console.log('\n────────────────────────────────────────────────────────────');
    console.log('  ELENCHI SALESNAV DISPONIBILI NEL DATABASE');
    console.log('────────────────────────────────────────────────────────────');
    if (lists.length === 0) {
        console.log('  (nessun elenco trovato nel DB)');
    } else {
        lists.forEach((l, i) => {
            console.log(`  ${i + 1}. ${l.name}`);
        });
    }
    console.log('────────────────────────────────────────────────────────────\n');

    while (true) {
        const input = await readLineFromStdin(
            lists.length > 0 ? `Scegli elenco (1-${lists.length}) o digita nome nuovo: ` : 'Digita il nome dell\'elenco: ',
        );
        if (!input) {
            console.log('  Il nome dell\'elenco non può essere vuoto.');
            continue;
        }
        const num = parseInt(input, 10);
        if (Number.isFinite(num) && num >= 1 && num <= lists.length) {
            return lists[num - 1].name;
        }
        // Accept any text as list name (new or existing)
        return input;
    }
}

async function waitForManualLinkedInLogin(page: Page, timeoutSeconds: number = 300): Promise<void> {
    const timeoutMs = Math.max(30, timeoutSeconds) * 1000;

    if (process.stdin.isTTY) {
        await waitForEnter();
    } else {
        console.log(
            `[INFO] stdin non interattivo rilevato: il browser restera' aperto e il login verra' atteso fino a ${Math.floor(timeoutMs / 1000)}s.`,
        );
    }

    const startedAt = Date.now();
    let lastLogAt = 0;

    while (Date.now() - startedAt <= timeoutMs) {
        const currentUrl = page.url().toLowerCase();
        const isStandardLoginPage = currentUrl.includes('/login') && !currentUrl.includes('/checkpoint');

        if (await isLoggedIn(page)) {
            const confirmed = await checkLogin(page);
            if (confirmed) {
                return;
            }
        }

        // During the standard login screen LinkedIn can render captcha-related
        // iframes/scripts that are not a hard block yet. Detect challenge only
        // once we leave /login or when checkpoint/challenge URLs appear.
        if (!isStandardLoginPage && (await detectChallenge(page))) {
            throw new Error('Challenge LinkedIn rilevato durante il login manuale.');
        }

        const now = Date.now();
        if (now - lastLogAt >= 15_000) {
            const remaining = Math.max(0, Math.ceil((timeoutMs - (now - startedAt)) / 1000));
            console.log(`In attesa completamento login LinkedIn... (${remaining}s rimanenti)`);
            lastLogAt = now;
        }

        await page.waitForTimeout(2500);
    }

    throw new Error(`Sessione LinkedIn non autenticata entro ${Math.floor(timeoutMs / 1000)} secondi.`);
}

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function runSalesNavSyncCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry-run') || positional.includes('dry');
    const listName = getOptionValue(args, '--list') ?? positional[0] ?? config.salesNavSyncListName;
    const listUrl = getOptionValue(args, '--url') ?? positional[1] ?? config.salesNavSyncListUrl;
    const maxPagesRaw = getOptionValue(args, '--max-pages');
    const maxPages = maxPagesRaw
        ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages'))
        : config.salesNavSyncMaxPages;
    const limitRaw = getOptionValue(args, '--limit');
    const maxLeadsPerList = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : config.salesNavSyncLimit;
    const accountId = getOptionValue(args, '--account') ?? config.salesNavSyncAccountId;

    const report = await runSalesNavigatorListSync({
        listName: listName?.trim() ? listName : null,
        listUrl: listUrl?.trim() ? listUrl : null,
        maxPages,
        maxLeadsPerList,
        dryRun,
        accountId: accountId || undefined,
    });
    console.log(JSON.stringify(report, null, 2));
}

export async function runSalesNavListsCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 200;
    const lists = await listSalesNavLists(limit);
    console.log(JSON.stringify({ total: lists.length, items: lists }, null, 2));
}

export async function runSalesNavCreateListCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const listName = getOptionValue(args, '--name') ?? positional[0];
    const accountId = getOptionValue(args, '--account') ?? config.salesNavSyncAccountId;
    if (!listName || !listName.trim()) {
        throw new Error('Specifica nome lista: salesnav-create-list <nome>');
    }
    const result = await createSalesNavList(listName, accountId || undefined);
    let dbListId: number | null = null;
    let dbSyncError: string | null = null;

    if (result.ok) {
        try {
            const normalizedName = (result.listName ?? listName).trim();
            if (result.listUrl) {
                const listRow = await upsertSalesNavList(normalizedName, result.listUrl);
                dbListId = listRow.id;
            } else {
                const existing = await getSalesNavListByName(normalizedName);
                dbListId = existing?.id ?? null;
            }
        } catch (error) {
            dbSyncError = error instanceof Error ? error.message : String(error);
        }
    }

    console.log(
        JSON.stringify(
            {
                ...result,
                dbSync: {
                    listId: dbListId,
                    synced: dbListId !== null,
                    error: dbSyncError,
                },
            },
            null,
            2,
        ),
    );
}

export async function runSalesNavAddLeadCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const leadIdRaw = getOptionValue(args, '--lead-id') ?? positional[0];
    const listName = getOptionValue(args, '--list') ?? positional[1];
    const accountId = getOptionValue(args, '--account') ?? config.salesNavSyncAccountId;

    if (!leadIdRaw) {
        throw new Error('Specifica leadId: salesnav-add-lead <leadId> <listName>');
    }
    if (!listName || !listName.trim()) {
        throw new Error('Specifica listName: salesnav-add-lead <leadId> <listName>');
    }

    const leadId = Math.max(1, parseIntStrict(leadIdRaw, '--lead-id'));
    const lead = await getLeadById(leadId);
    if (!lead) {
        throw new Error(`Lead non trovato: ${leadId} `);
    }

    const result = await addLeadToSalesNavList(lead.linkedin_url, listName, accountId || undefined);
    const targetListName = (result.listName ?? listName).trim();
    let dbListId: number | null = null;
    let dbLinked = false;
    let dbSyncError: string | null = null;

    if (result.ok) {
        try {
            let listRow = await getSalesNavListByName(targetListName);
            if (!listRow && result.listUrl) {
                listRow = await upsertSalesNavList(targetListName, result.listUrl);
            }
            if (listRow) {
                dbListId = listRow.id;
                await linkLeadToSalesNavList(listRow.id, leadId);
                dbLinked = true;
            }
        } catch (error) {
            dbSyncError = error instanceof Error ? error.message : String(error);
        }
    }

    console.log(
        JSON.stringify(
            {
                leadId,
                listName,
                leadUrl: lead.linkedin_url,
                dbSync: {
                    listId: dbListId,
                    linked: dbLinked,
                    error: dbSyncError,
                },
                ...result,
            },
            null,
            2,
        ),
    );
}

export async function runSalesNavResolveCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 25;
    const fix = hasOption(args, '--fix') || positional.includes('fix');
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry-run') || positional.includes('dry');

    const leads = await getLeadsWithSalesNavigatorUrls(limit);
    const report: SalesNavResolveReport = {
        scanned: 0,
        resolvable: 0,
        updated: 0,
        conflicts: 0,
        unresolved: 0,
        challengeDetected: false,
        fix,
        dryRun,
        items: [],
    };

    if (leads.length === 0) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    const session = await launchBrowser({ headless: config.headless });
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            throw new Error('Sessione LinkedIn non autenticata. Esegui prima: .\\bot.ps1 login');
        }

        for (const lead of leads) {
            report.scanned += 1;
            try {
                await session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
                await humanDelay(session.page, 1000, 2000);

                if (await detectChallenge(session.page)) {
                    report.challengeDetected = true;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl: null,
                        action: 'challenge_detected',
                    });
                    break;
                }

                const candidates = await collectProfileUrlCandidates(session.page);
                const resolvedProfileUrl = pickResolvedProfileUrl(candidates);
                if (!resolvedProfileUrl) {
                    report.unresolved += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl: null,
                        action: 'unresolved',
                    });
                    continue;
                }

                report.resolvable += 1;
                if (!fix || dryRun) {
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl,
                        action: 'resolved',
                    });
                    continue;
                }

                const updated = await updateLeadLinkedinUrl(lead.id, resolvedProfileUrl);
                if (updated.updated) {
                    const recoveryStatus =
                        lead.status === 'BLOCKED' ? getRecoveryStatusFromBlockedReason(lead.blocked_reason) : null;
                    if (recoveryStatus) {
                        await reconcileLeadStatus(lead.id, recoveryStatus, 'salesnav_profile_url_resolved', {
                            previousStatus: lead.status,
                            blockedReason: lead.blocked_reason,
                        });
                    }
                    report.updated += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl,
                        action: 'updated',
                    });
                } else {
                    report.conflicts += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl,
                        action: 'conflict',
                        conflictLeadId: updated.conflictLeadId,
                    });
                }
            } catch (error) {
                report.items.push({
                    leadId: lead.id,
                    status: lead.status,
                    currentUrl: lead.linkedin_url,
                    resolvedProfileUrl: null,
                    action: 'error',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    } finally {
        await closeBrowserSession(session);
    }

    console.log(JSON.stringify(report, null, 2));
}

export async function runSalesNavExtractSearchCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const searchUrl = getOptionValue(args, '--url') ?? positional[0];
    const targetListName = getOptionValue(args, '--list') ?? positional[1];
    const maxPagesRaw = getOptionValue(args, '--max-pages');
    const maxPages = maxPagesRaw ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages')) : 5;

    if (!searchUrl) {
        throw new Error('Specificare l\'URL della ricerca salvata. Esempio: salesnav-extract-search <searchUrl> <listName>');
    }
    if (!targetListName) {
        throw new Error('Specificare il nome della lista di destinazione. Esempio: salesnav-extract-search <searchUrl> <listName>');
    }

    const session = await launchBrowser({ headless: config.headless });
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            throw new Error('Sessione LinkedIn non autenticata. Esegui prima: .\\bot.ps1 login');
        }

        const report = await scrapeSavedSearchAndSaveToList(session.page, searchUrl, targetListName, maxPages);
        console.log(JSON.stringify({ ok: true, report }, null, 2));
    } catch (error) {
        console.error('Errore durante l\'estrazione dalla ricerca salvata:', error);
        throw error;
    } finally {
        await closeBrowserSession(session);
    }
}

/**
 * salesnav-extract-first-search
 *
 * Apre il browser (visibile), aspetta il login dell'utente, naviga alle
 * ricerche salvate, clicca "Visualizza" sulla prima ricerca trovata e
 * poi per ogni pagina: Seleziona tutto → Salva nell'elenco (lista recente
 * o quella indicata con --list).
 *
 * Opzioni:
 *   --list <nome>       Nome elenco di destinazione (default: primo elenco recente nel dropdown)
 *   --max-pages <n>     Numero massimo di pagine (default: 10)
 *   --account <id>      Account da usare
 */
export async function runSalesNavExtractFirstSearchCommand(args: string[]): Promise<void> {
    const targetListName = getOptionValue(args, '--list') ?? undefined;
    const maxPagesRaw = getOptionValue(args, '--max-pages');
    const visualCursor = hasOption(args, '--visual-cursor') || hasNpmConfigFlag('visual-cursor');
    const maxPages = maxPagesRaw ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages')) : 10;

    // Forza headless=false e bypassProxy=true: login manuale senza proxy intermedi
    const session = await launchBrowser({ headless: false, bypassProxy: true });
    try {
        // Naviga direttamente al login così il flusso manuale non dipende da redirect.
        await session.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

        console.log('\n──────────────────────────────────────────────────────────────');
        console.log('  Bot pronto. Effettua il LOGIN su LinkedIn nel browser aperto.');
        console.log('  Quando sei loggato, premi INVIO qui per continuare.');
        console.log('  Se il terminale non e\' interattivo, il bot attendera\' il login automaticamente.');
        console.log('──────────────────────────────────────────────────────────────\n');

        await waitForManualLinkedInLogin(session.page);
        if (visualCursor) {
            await enableVisualCursorOverlay(session.page);
        }

        console.log('[OK] Login rilevato. Avvio elaborazione di tutte le ricerche salvate...');
        const report = await scrapeAllSavedSearchesAndSaveToList(session.page, maxPages, targetListName);
        console.log(JSON.stringify({ ok: true, report }, null, 2));
    } catch (error) {
        console.error('Errore durante l\'estrazione dalla prima ricerca salvata:', error);
        throw error;
    } finally {
        await closeBrowserSession(session);
    }
}

export async function runSalesNavBulkSaveCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);

    // --list and --search-name are optional: if missing, the user picks interactively
    // after login when the browser is open and searches are visible.
    let targetListName = getOptionValue(args, '--list') ?? getNpmConfigOptionValue('list') ?? positional[0] ?? null;
    let searchName = getOptionValue(args, '--search-name') ?? getNpmConfigOptionValue('search-name') ?? null;

    const maxPagesRaw = getOptionValue(args, '--max-pages') ?? getNpmConfigOptionValue('max-pages');
    const maxSearchesRaw = getOptionValue(args, '--max-searches') ?? getNpmConfigOptionValue('max-searches');
    const sessionLimitRaw = getOptionValue(args, '--session-limit') ?? getNpmConfigOptionValue('session-limit');
    const visualCursor = hasOption(args, '--visual-cursor') || hasNpmConfigFlag('visual-cursor');
    const resume = hasOption(args, '--resume') || hasNpmConfigFlag('resume');
    const dryRun = hasOption(args, '--dry-run') || hasNpmConfigFlag('dry-run');
    const accountId =
        getOptionValue(args, '--account') ?? getNpmConfigOptionValue('account') ?? config.salesNavSyncAccountId;

    const maxPages = maxPagesRaw ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages')) : 10;
    const maxSearches = maxSearchesRaw ? Math.max(1, parseIntStrict(maxSearchesRaw, '--max-searches')) : null;
    const sessionLimit = sessionLimitRaw ? Math.max(1, parseIntStrict(sessionLimitRaw, '--session-limit')) : null;

    const account = getAccountProfileById(accountId || undefined);
    const session = await launchBrowser({
        headless: false,
        sessionDir: account.sessionDir,
        bypassProxy: true,
    });

    try {
        await session.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

        console.log('\n──────────────────────────────────────────────────────────────');
        console.log('  SalesNav bulk save pronto.');
        console.log('  Effettua il LOGIN nel browser aperto o verifica che la sessione sia attiva.');
        console.log('  Quando sei pronto, premi INVIO qui per continuare.');
        console.log('  Se il terminale non e\' interattivo, il bot attendera\' il login automaticamente.');
        console.log('──────────────────────────────────────────────────────────────\n');

        await waitForManualLinkedInLogin(session.page);
        if (visualCursor) {
            await enableVisualCursorOverlay(session.page);
        }

        // Interactive search selection: navigate to saved searches, show the list,
        // ask the user to pick. Runs only when --search-name was not passed.
        if (!searchName || !searchName.trim()) {
            await session.page.goto(SEARCHES_URL, { waitUntil: 'domcontentloaded' });
            await humanDelay(session.page, 1500, 2800);
            const discovered = await extractSavedSearches(session.page);
            if (discovered.length === 0) {
                throw new Error('Nessuna ricerca salvata trovata in Sales Navigator. Verifica di essere nella sezione corretta.');
            }
            if (process.stdin.isTTY) {
                const chosen = await askUserToChooseSearch(discovered);
                searchName = chosen.name;
                console.log(`\n[OK] Ricerca selezionata: "${searchName}"\n`);
            } else {
                // Non-interactive: use the first search.
                searchName = discovered[0].name;
                console.log(`[INFO] Terminale non interattivo: uso prima ricerca trovata: "${searchName}"`);
            }
        }

        // Interactive list selection: show DB lists + ask the user.
        // Runs only when --list was not passed.
        if (!targetListName || !targetListName.trim()) {
            if (process.stdin.isTTY) {
                targetListName = await askUserToChooseList();
                console.log(`\n[OK] Elenco selezionato: "${targetListName}"\n`);
            } else {
                throw new Error('Lista non specificata. Usa --list "NOME LISTA" oppure esegui in modalità interattiva.');
            }
        }

        const report = await runSalesNavBulkSave(session.page, {
            accountId: account.id,
            targetListName: targetListName.trim(),
            maxPages,
            maxSearches,
            searchName: searchName.trim() || null,
            resume,
            dryRun,
            sessionLimit,
        });

        console.log(JSON.stringify(report, null, 2));

        if (process.stdin.isTTY) {
            console.log('\nRun terminato. Premi INVIO per chiudere il browser.');
            await waitForEnter();
        }
    } finally {
        await closeBrowserSession(session);
    }
}

