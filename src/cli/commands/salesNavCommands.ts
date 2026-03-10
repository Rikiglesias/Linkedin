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
    humanDelay,
    detectChallenge,
} from '../../browser';
import { blockUserInput } from '../../browser/humanBehavior';
import {
    getLeadById,
    getLeadsWithSalesNavigatorUrls,
    getSalesNavListByName,
    listSalesNavLists,
    linkLeadToSalesNavList,
    upsertSalesNavList,
    updateLeadLinkedinUrl,
    updateLeadProfileData,
} from '../../core/repositories';
import { reconcileLeadStatus } from '../../core/leadStateService';
import { runSalesNavigatorListSync, formatFinalReport } from '../../core/salesNavigatorSync';
import {
    runSalesNavBulkSave,
} from '../../salesnav/bulkSaveOrchestrator';
import { addLeadToSalesNavList, createSalesNavList } from '../../salesnav/listActions';
// searchExtractor.ts rimosso — logica legacy sostituita da bulkSaveOrchestrator
import { isProfileUrl, isSalesNavigatorUrl, normalizeLinkedInUrl } from '../../linkedinUrl';
import { getOptionValue, hasOption, parseIntStrict, getPositionalArgs } from '../cliParser';
import { sendTelegramAlert } from '../../telemetry/alerts';

// ─── Tipi locali ──────────────────────────────────────────────────────────────

interface SalesNavProfileData {
    firstName: string | null;
    lastName: string | null;
    headline: string | null;
    company: string | null;
    location: string | null;
}

interface SalesNavResolveItem {
    leadId: number;
    status: string;
    currentUrl: string;
    resolvedProfileUrl: string | null;
    action: 'resolved' | 'updated' | 'conflict' | 'unresolved' | 'challenge_detected' | 'error';
    conflictLeadId?: number | null;
    profileData?: SalesNavProfileData | null;
    error?: string;
}

interface SalesNavResolveReport {
    scanned: number;
    resolvable: number;
    updated: number;
    enriched: number;
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

async function extractSalesNavProfileData(page: Page): Promise<SalesNavProfileData> {
    return page.evaluate(() => {
        const text = (sel: string): string | null => {
            const el = document.querySelector(sel);
            return el?.textContent?.trim() || null;
        };

        // SalesNav profile topcard selectors (multiple fallbacks)
        const firstName =
            text('[data-anonymize="person-name"]')?.split(/\s+/)[0] ??
            text('.profile-topcard-person-entity__name')?.split(/\s+/)[0] ??
            null;

        const fullName =
            text('[data-anonymize="person-name"]') ??
            text('.profile-topcard-person-entity__name') ??
            null;
        const lastName = fullName ? fullName.split(/\s+/).slice(1).join(' ') || null : null;

        const headline =
            text('.profile-topcard__summary-position') ??
            text('[data-anonymize="headline"]') ??
            text('.profile-topcard__headline') ??
            null;

        const company =
            text('[data-anonymize="company-name"]') ??
            text('.profile-topcard__summary-company') ??
            text('.profile-topcard-person-entity__summary-position-company') ??
            null;

        const location =
            text('[data-anonymize="location"]') ??
            text('[data-anonymize="geography"]') ??
            text('.profile-topcard__location-data') ??
            text('.profile-topcard-person-entity__location') ??
            null;

        return { firstName, lastName, headline, company, location };
    });
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

// Re-export da stdinHelper per backward-compat locale
import { waitForEnter, readLineFromStdin } from '../stdinHelper';
export { waitForEnter, readLineFromStdin };

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

// ─── Sessione condivisa anti-detection ────────────────────────────────────────

/**
 * Helper condiviso: lancia browser con stack anti-detection completo,
 * gestisce login manuale, blocca input utente.
 * Usato da tutti i comandi SalesNav che aprono il browser.
 */
async function ensureSalesNavSession(args: string[], opts?: { interactive?: boolean }) {
    const accountId =
        getOptionValue(args, '--account') ?? getNpmConfigOptionValue('account') ?? config.salesNavSyncAccountId;
    const noProxy = hasOption(args, '--no-proxy');
    const account = getAccountProfileById(accountId || undefined);

    const session = await launchBrowser({
        headless: false,
        sessionDir: account.sessionDir,
        proxy: noProxy ? undefined : account.proxy,
        bypassProxy: noProxy,
        forceDesktop: true,
    });

    // Auto-detect login
    const alreadyLoggedIn = await checkLogin(session.page);
    if (alreadyLoggedIn) {
        console.log('[OK] Sessione LinkedIn gia\' attiva.');
    } else {
        const currentUrl = session.page.url().toLowerCase();
        if (!currentUrl.includes('/login')) {
            await session.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' }).catch(() => null);
        }
        console.log('\n──────────────────────────────────────────────────────────────');
        console.log('  SalesNav pronto. Completa il LOGIN nel browser.');
        console.log('  Premi INVIO qui quando sei loggato.');
        console.log('──────────────────────────────────────────────────────────────\n');
        await waitForManualLinkedInLogin(session.page);
    }

    // Blocca input utente dopo login — skip in interactive per mouse libero
    if (!opts?.interactive) {
        await blockUserInput(session.page);
        console.log('[OK] Input bloccato. Avvio automazione...');
    } else {
        console.log('[OK] Avvio automazione (mouse libero)...');
    }

    return { session, account };
}

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function runSalesNavSyncCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry-run') || positional.includes('dry');
    const interactive = hasOption(args, '--interactive') || hasOption(args, '-i');
    const listName = getOptionValue(args, '--list') ?? positional[0] ?? config.salesNavSyncListName;
    const positionalUrl = positional[1] && /^https?:\/\//i.test(positional[1]) ? positional[1] : undefined;
    const listUrl = getOptionValue(args, '--url') ?? positionalUrl ?? config.salesNavSyncListUrl;
    const maxPagesRaw = getOptionValue(args, '--max-pages');
    const maxPages = maxPagesRaw
        ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages'))
        : config.salesNavSyncMaxPages;
    const limitRaw = getOptionValue(args, '--limit');
    const maxLeadsPerList = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : config.salesNavSyncLimit;
    const accountId = getOptionValue(args, '--account') ?? config.salesNavSyncAccountId;
    const noProxy = hasOption(args, '--no-proxy');

    const report = await runSalesNavigatorListSync({
        listName: listName?.trim() ? listName : null,
        listUrl: listUrl?.trim() ? listUrl : null,
        maxPages,
        maxLeadsPerList,
        dryRun,
        accountId: accountId || undefined,
        interactive,
        noProxy,
    });
    console.log(formatFinalReport(report));
    console.log('\n[JSON completo]');
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
        enriched: 0,
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

    const { session } = await ensureSalesNavSession(args);
    try {
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

                const [candidates, profileData] = await Promise.all([
                    collectProfileUrlCandidates(session.page),
                    extractSalesNavProfileData(session.page),
                ]);
                const resolvedProfileUrl = pickResolvedProfileUrl(candidates);
                if (!resolvedProfileUrl) {
                    report.unresolved += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl: null,
                        profileData,
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
                        profileData,
                        action: 'resolved',
                    });
                    continue;
                }

                const updated = await updateLeadLinkedinUrl(lead.id, resolvedProfileUrl);
                if (updated.updated) {
                    // Enrich lead with profile data extracted from SalesNav page
                    const hasProfileData =
                        profileData.firstName || profileData.lastName || profileData.headline || profileData.company;
                    if (hasProfileData) {
                        await updateLeadProfileData(lead.id, {
                            firstName: profileData.firstName ?? undefined,
                            lastName: profileData.lastName ?? undefined,
                            jobTitle: profileData.headline ?? undefined,
                            about: profileData.company ? `Company: ${profileData.company}` : undefined,
                        });
                        report.enriched += 1;
                    }

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
                        profileData,
                        action: 'updated',
                    });
                } else {
                    report.conflicts += 1;
                    report.items.push({
                        leadId: lead.id,
                        status: lead.status,
                        currentUrl: lead.linkedin_url,
                        resolvedProfileUrl,
                        profileData,
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

export async function runSalesNavBulkSaveCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);

    let targetListName = getOptionValue(args, '--list') ?? getNpmConfigOptionValue('list') ?? positional[0] ?? null;
    let searchName = getOptionValue(args, '--search-name') ?? getNpmConfigOptionValue('search-name') ?? null;

    const maxPagesRaw = getOptionValue(args, '--max-pages') ?? getNpmConfigOptionValue('max-pages');
    const maxSearchesRaw = getOptionValue(args, '--max-searches') ?? getNpmConfigOptionValue('max-searches');
    const sessionLimitRaw = getOptionValue(args, '--session-limit') ?? getNpmConfigOptionValue('session-limit');
    const resume = hasOption(args, '--resume') || hasNpmConfigFlag('resume');
    const dryRun = hasOption(args, '--dry-run') || hasNpmConfigFlag('dry-run');

    const maxPages = maxPagesRaw ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages')) : 10;
    const maxSearches = maxSearchesRaw ? Math.max(1, parseIntStrict(maxSearchesRaw, '--max-searches')) : null;
    const sessionLimit = sessionLimitRaw ? Math.max(1, parseIntStrict(sessionLimitRaw, '--session-limit')) : null;

    const { session, account } = await ensureSalesNavSession(args);

    try {
        if (!searchName || !searchName.trim()) {
            searchName = null;
            console.log('[INFO] Nessuna --search-name specificata: verranno processate tutte le ricerche salvate.');
        }

        if (!targetListName || !targetListName.trim()) {
            if (process.stdin.isTTY) {
                targetListName = await askUserToChooseList();
                console.log(`\n[OK] Elenco selezionato: "${targetListName}"\n`);
            } else {
                throw new Error('Lista non specificata. Usa --list "NOME LISTA".');
            }
        }

        const report = await runSalesNavBulkSave(session.page, {
            accountId: account.id,
            targetListName: targetListName.trim(),
            maxPages,
            maxSearches,
            searchName: searchName?.trim() || null,
            resume,
            dryRun,
            sessionLimit,
        });

        console.log(JSON.stringify(report, null, 2));

        const statusIcon = report.status === 'SUCCESS' ? '✅' : report.status === 'PAUSED' ? '⏸️' : '❌';
        const telegramLines = [
            `<b>${statusIcon} SalesNav Bulk Save — ${report.status}</b>`,
            ``,
            `📋 Lista: <code>${report.targetListName}</code>`,
            `🔍 Ricerche: ${report.searchesProcessed}/${report.searchesPlanned}`,
            `📄 Pagine processate: ${report.pagesProcessed}`,
            `👤 Lead salvati: ${report.totalLeadsSaved}`,
            report.pagesSkippedAllSaved > 0
                ? `⏭️ Pagine skippate (già salvate): ${report.pagesSkippedAllSaved}`
                : '',
            report.challengeDetected ? `\n⚠️ Challenge LinkedIn rilevato` : '',
            report.lastError ? `\n❗ Ultimo errore: ${report.lastError}` : '',
        ]
            .filter(Boolean)
            .join('\n');

        const severity = report.status === 'SUCCESS' ? 'info' : report.status === 'PAUSED' ? 'warn' : 'critical';
        await sendTelegramAlert(telegramLines, undefined, severity).catch(() => {});

        const closeDelaySec = 3 + Math.floor(Math.random() * 3);
        console.log(`\nRun terminato. Chiusura browser tra ${closeDelaySec}s...`);
        await new Promise(resolve => setTimeout(resolve, closeDelaySec * 1000));
    } finally {
        await closeBrowserSession(session);
    }
}

// ─── Comando unificato ────────────────────────────────────────────────────────

const SALESNAV_SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
    save: runSalesNavBulkSaveCommand,
    sync: runSalesNavSyncCommand,
    resolve: runSalesNavResolveCommand,
    lists: runSalesNavListsCommand,
    create: runSalesNavCreateListCommand,
    add: runSalesNavAddLeadCommand,
};

/**
 * Comando unificato `salesnav`. Smista in base al primo argomento posizionale:
 *   salesnav save --list "X"       → bulk save (default)
 *   salesnav sync --list "X"       → sync lista
 *   salesnav resolve --fix         → risolvi URL
 *   salesnav lists                 → mostra elenchi
 *   salesnav create "Nome"         → crea lista
 *   salesnav add <leadId> <list>   → aggiungi lead
 *
 * Se nessun sotto-comando riconosciuto → default bulk-save.
 */
export async function runSalesNavUnifiedCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const subCommand = positional[0]?.toLowerCase() ?? '';

    const handler = SALESNAV_SUBCOMMANDS[subCommand];
    if (handler) {
        // Rimuovi il sotto-comando dagli args e passa il resto
        const subArgs = args.filter((a) => a.toLowerCase() !== subCommand);
        await handler(subArgs);
    } else if (subCommand && !subCommand.startsWith('http') && !/^\d+$/.test(subCommand)) {
        // Primo argomento non è un sotto-comando valido, né un URL né un numero
        const validSubs = Object.keys(SALESNAV_SUBCOMMANDS).join(', ');
        console.warn(`[WARN] Sotto-comando sconosciuto: "${subCommand}". Comandi validi: ${validSubs}`);
        console.warn('[WARN] Fallback → salesnav save');
        await runSalesNavBulkSaveCommand(args);
    } else {
        // Nessun sotto-comando → default bulk-save con tutti gli args
        await runSalesNavBulkSaveCommand(args);
    }
}

