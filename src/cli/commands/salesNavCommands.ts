/**
 * salesNavCommands.ts — Comandi CLI relativi a Sales Navigator
 */

import { Page } from 'playwright';
import { config } from '../../config';
import { launchBrowser, closeBrowser as closeBrowserSession, checkLogin, humanDelay, detectChallenge } from '../../browser';
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
import { addLeadToSalesNavList, createSalesNavList } from '../../salesnav/listActions';
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

    const canonicalHref = await page.locator('link[rel="canonical"]').first().getAttribute('href').catch(() => null);
    if (canonicalHref) candidates.add(canonicalHref);

    const ogUrl = await page.locator('meta[property="og:url"]').first().getAttribute('content').catch(() => null);
    if (ogUrl) candidates.add(ogUrl);

    const anchors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
            .map((node) => (node as HTMLAnchorElement).href)
            .filter((href) => typeof href === 'string' && href.length > 0);
    }).catch(() => [] as string[]);

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

function getRecoveryStatusFromBlockedReason(reason: string | null): 'READY_INVITE' | 'INVITED' | 'READY_MESSAGE' | null {
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

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function runSalesNavSyncCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const dryRun = hasOption(args, '--dry-run') || positional.includes('dry-run') || positional.includes('dry');
    const listName = getOptionValue(args, '--list') ?? positional[0] ?? config.salesNavSyncListName;
    const listUrl = getOptionValue(args, '--url') ?? positional[1] ?? config.salesNavSyncListUrl;
    const maxPagesRaw = getOptionValue(args, '--max-pages');
    const maxPages = maxPagesRaw ? Math.max(1, parseIntStrict(maxPagesRaw, '--max-pages')) : config.salesNavSyncMaxPages;
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

    console.log(JSON.stringify({
        ...result,
        dbSync: {
            listId: dbListId,
            synced: dbListId !== null,
            error: dbSyncError,
        },
    }, null, 2));
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

    console.log(JSON.stringify({
        leadId,
        listName,
        leadUrl: lead.linkedin_url,
        dbSync: {
            listId: dbListId,
            linked: dbLinked,
            error: dbSyncError,
        },
        ...result,
    }, null, 2));
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
                    const recoveryStatus = lead.status === 'BLOCKED'
                        ? getRecoveryStatusFromBlockedReason(lead.blocked_reason)
                        : null;
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
