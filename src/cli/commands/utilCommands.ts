/**
 * utilCommands.ts — Comandi CLI di utilità
 *
 * import, login, funnel, site-check, state-sync, proxy-status,
 * random-activity, enrich-targets, workflow-run
 */

import { config } from '../../config';
import { launchBrowser, closeBrowser as closeBrowserSession, checkLogin, isLoggedIn } from '../../browser';
import { importLeadsFromCSV } from '../../csvImporter';
import { buildFunnelReport, runSiteCheck } from '../../core/audit';
import { runCompanyEnrichmentBatch } from '../../core/companyEnrichment';
import { runRandomLinkedinActivity } from '../../workers/randomActivityWorker';
import { getAccountProfileById, getRuntimeAccountProfiles } from '../../accountManager';
import { getProxyFailoverChain, getProxyPoolStatus } from '../../proxyManager';
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
        `Import completato.Lead inseriti = ${result.inserted}, Company target inseriti = ${result.companyTargetsInserted}, Skippati = ${result.skipped}, Lista = ${listName} `
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
        console.warn(`[LOGIN] account = ${accountRaw} non trovato.Uso account = ${selectedAccount.id}.Disponibili: ${availableAccounts.join(', ')} `);
    }

    const session = await launchBrowser({
        headless: false,
        sessionDir: selectedAccount.sessionDir,
        proxy: selectedAccount.proxy,
    });
    try {
        await session.page.goto('https://www.linkedin.com/login', { waitUntil: 'load' });
        console.log(`Completa il login LinkedIn nella finestra aperta(account = ${selectedAccount.id}, timeout ${timeoutSeconds}s)...`);
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
    console.log(JSON.stringify({
        mode: 'state_sync',
        limitPerStatus: limit,
        autoFix,
        report,
    }, null, 2));
}

export async function runProxyStatusCommand(): Promise<void> {
    const status = getProxyPoolStatus();
    const failoverChain = getProxyFailoverChain().map((proxy, index) => ({
        order: index + 1,
        server: proxy.server,
        auth: !!proxy.username || !!proxy.password,
    }));

    console.log(JSON.stringify({
        ...status,
        failoverChain,
    }, null, 2));
}

export async function runRandomActivityCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const maxActionsRaw = getOptionValue(args, '--max-actions')
        ?? getOptionValue(args, '--actions')
        ?? positional.find((value) => /^\d+$/.test(value));
    const accountId = getOptionValue(args, '--account')
        ?? positional.find((value) => {
            const normalized = value.toLowerCase();
            if (normalized === 'dry' || normalized === 'dry-run') return false;
            return !value.startsWith('--') && !/^\d+$/.test(value);
        })
        ?? config.salesNavSyncAccountId
        ?? undefined;
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
