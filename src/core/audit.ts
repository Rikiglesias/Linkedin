import { checkLogin, closeBrowser, detectChallenge, humanDelay, launchBrowser } from '../browser';
import { getAccountProfileById, pickAccountIdForLead } from '../accountManager';
import { config } from '../config';
import { quarantineAccount } from '../risk/incidentManager';
import { SELECTORS } from '../selectors';
import { LeadRecord } from '../types/domain';
import { reconcileLeadStatus, transitionLead } from './leadStateService';
import {
    countCompanyTargets,
    countCompanyTargetsByStatuses,
    countLeadsByStatuses,
    countPendingOutboxEvents,
    getJobStatusCounts,
    getLeadsByStatusForSiteCheck,
    JobStatusCounts,
    touchLeadSiteCheckAt,
} from './repositories';
import { Page } from 'playwright';

export interface FunnelReport {
    totals: {
        leads: number;
        companyTargets: number;
        queuedJobs: number;
        pendingOutbox: number;
    };
    connections: {
        toSend: number;
        invitedPendingAcceptance: number;
        acceptedReadyMessage: number;
        completed: number;
    };
    messages: {
        toSend: number;
        sent: number;
        blockedOrSkipped: number;
    };
    companyTargetStatuses: {
        NEW: number;
        ENRICHED: number;
        NO_MATCH: number;
        ERROR: number;
    };
    leadStatuses: Record<string, number>;
    jobs: JobStatusCounts;
}

export interface SiteCheckItem {
    leadId: number;
    status: string;
    linkedinUrl: string;
    siteSignals: {
        pendingInvite: boolean;
        connected: boolean;
        messageButton: boolean;
        canConnect: boolean;
    };
    mismatch: string;
    fixed: boolean;
}

export interface SiteCheckReport {
    scanned: number;
    mismatches: number;
    fixed: number;
    items: SiteCheckItem[];
}

export interface SiteCheckOptions {
    limitPerStatus: number;
    autoFix: boolean;
    staleDays?: number;
}

function isFirstDegreeBadge(text: string | null): boolean {
    if (!text) return true;
    return /1st|1°|1\b/i.test(text);
}

async function inspectLeadOnSite(lead: LeadRecord, sessionPage: Page): Promise<{
    pendingInvite: boolean;
    connected: boolean;
    messageButton: boolean;
    canConnect: boolean;
}> {
    await sessionPage.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await humanDelay(sessionPage, 1200, 2200);

    const messageButton = (await sessionPage.locator(SELECTORS.messageButton).count()) > 0;
    const badgeText = await sessionPage.locator(SELECTORS.distanceBadge).first().textContent().catch(() => '');
    const connected = messageButton && isFirstDegreeBadge(badgeText);
    const pendingInvite = (await sessionPage.locator(SELECTORS.invitePendingIndicators).count()) > 0;
    const canConnect = (await sessionPage.locator(SELECTORS.connectButtonPrimary).count()) > 0;

    return {
        pendingInvite,
        connected,
        messageButton,
        canConnect,
    };
}

async function tryAutoFix(lead: LeadRecord, mismatch: string): Promise<boolean> {
    if (mismatch === 'invited_but_connected') {
        await transitionLead(lead.id, 'ACCEPTED', 'site_check_autofix_connected');
        await transitionLead(lead.id, 'READY_MESSAGE', 'site_check_autofix_ready_message');
        return true;
    }

    if (mismatch === 'ready_invite_but_pending') {
        await transitionLead(lead.id, 'INVITED', 'site_check_autofix_pending');
        return true;
    }

    if (mismatch === 'ready_invite_but_connected') {
        await transitionLead(lead.id, 'INVITED', 'site_check_autofix_connected_promote_invited');
        await transitionLead(lead.id, 'ACCEPTED', 'site_check_autofix_connected_promote_accepted');
        await transitionLead(lead.id, 'READY_MESSAGE', 'site_check_autofix_connected_promote_ready_message');
        return true;
    }

    if (mismatch === 'ready_message_but_pending_invite') {
        await reconcileLeadStatus(lead.id, 'INVITED', 'site_check_reconcile_ready_message_to_invited_pending');
        return true;
    }

    if (mismatch === 'messaged_but_pending_invite') {
        await reconcileLeadStatus(lead.id, 'INVITED', 'site_check_reconcile_messaged_to_invited_pending');
        return true;
    }

    if (mismatch === 'invited_but_connect_available') {
        await reconcileLeadStatus(lead.id, 'READY_INVITE', 'site_check_reconcile_invited_to_ready_invite_connect_available');
        return true;
    }

    return false;
}

export async function buildFunnelReport(): Promise<FunnelReport> {
    const [
        newCount,
        readyInviteCount,
        invitedCount,
        acceptedCount,
        readyMessageCount,
        messagedCount,
        blockedCount,
        skippedCount,
        pendingOutbox,
        companyTargets,
        companyTargetsNew,
        companyTargetsEnriched,
        companyTargetsNoMatch,
        companyTargetsError,
        jobs,
    ] = await Promise.all([
        countLeadsByStatuses(['NEW']),
        countLeadsByStatuses(['READY_INVITE', 'PENDING']),
        countLeadsByStatuses(['INVITED']),
        countLeadsByStatuses(['ACCEPTED']),
        countLeadsByStatuses(['READY_MESSAGE']),
        countLeadsByStatuses(['MESSAGED']),
        countLeadsByStatuses(['BLOCKED']),
        countLeadsByStatuses(['SKIPPED']),
        countPendingOutboxEvents(),
        countCompanyTargets(),
        countCompanyTargetsByStatuses(['NEW']),
        countCompanyTargetsByStatuses(['ENRICHED']),
        countCompanyTargetsByStatuses(['NO_MATCH']),
        countCompanyTargetsByStatuses(['ERROR']),
        getJobStatusCounts(),
    ]);

    const totalLeads = newCount + readyInviteCount + invitedCount + acceptedCount + readyMessageCount + messagedCount + blockedCount + skippedCount;
    const queuedJobs = Object.values(jobs).reduce((acc, value) => acc + value, 0);

    return {
        totals: {
            leads: totalLeads,
            companyTargets,
            queuedJobs,
            pendingOutbox,
        },
        connections: {
            toSend: newCount + readyInviteCount,
            invitedPendingAcceptance: invitedCount,
            acceptedReadyMessage: acceptedCount + readyMessageCount,
            completed: messagedCount,
        },
        messages: {
            toSend: readyMessageCount,
            sent: messagedCount,
            blockedOrSkipped: blockedCount + skippedCount,
        },
        companyTargetStatuses: {
            NEW: companyTargetsNew,
            ENRICHED: companyTargetsEnriched,
            NO_MATCH: companyTargetsNoMatch,
            ERROR: companyTargetsError,
        },
        leadStatuses: {
            NEW: newCount,
            READY_INVITE: readyInviteCount,
            INVITED: invitedCount,
            ACCEPTED: acceptedCount,
            READY_MESSAGE: readyMessageCount,
            MESSAGED: messagedCount,
            BLOCKED: blockedCount,
            SKIPPED: skippedCount,
        },
        jobs,
    };
}

export async function runSiteCheck(options: SiteCheckOptions): Promise<SiteCheckReport> {
    const limit = Math.max(1, options.limitPerStatus);
    const staleDays = Math.max(0, options.staleDays ?? config.siteCheckStaleDays);
    const [readyInviteLeads, invitedLeads, readyMessageLeads, messagedLeads] = await Promise.all([
        getLeadsByStatusForSiteCheck('READY_INVITE', limit, staleDays),
        getLeadsByStatusForSiteCheck('INVITED', limit, staleDays),
        getLeadsByStatusForSiteCheck('READY_MESSAGE', limit, staleDays),
        getLeadsByStatusForSiteCheck('MESSAGED', Math.max(5, Math.floor(limit / 2)), staleDays),
    ]);

    const candidates = [...readyInviteLeads, ...invitedLeads, ...readyMessageLeads, ...messagedLeads];
    if (candidates.length === 0) {
        return {
            scanned: 0,
            mismatches: 0,
            fixed: 0,
            items: [],
        };
    }

    const report: SiteCheckReport = {
        scanned: 0,
        mismatches: 0,
        fixed: 0,
        items: [],
    };

    const leadsByAccount = new Map<string, LeadRecord[]>();
    for (const lead of candidates) {
        const accountId = pickAccountIdForLead(lead.id);
        if (!leadsByAccount.has(accountId)) {
            leadsByAccount.set(accountId, []);
        }
        leadsByAccount.get(accountId)?.push(lead);
    }

    let challengeDetected = false;
    for (const [accountId, accountLeads] of leadsByAccount) {
        const account = getAccountProfileById(accountId);
        const session = await launchBrowser({
            sessionDir: account.sessionDir,
            proxy: account.proxy,
        });
        try {
            const loggedIn = await checkLogin(session.page);
            if (!loggedIn) {
                await quarantineAccount('SITE_CHECK_LOGIN_MISSING', {
                    reason: 'Sessione non autenticata durante site-check',
                    accountId,
                });
                return report;
            }

            for (const lead of accountLeads) {
                report.scanned += 1;
                const signals = await inspectLeadOnSite(lead, session.page);
                await touchLeadSiteCheckAt(lead.id);

                if (await detectChallenge(session.page)) {
                    await quarantineAccount('SITE_CHECK_CHALLENGE_DETECTED', {
                        leadId: lead.id,
                        status: lead.status,
                        linkedinUrl: lead.linkedin_url,
                        accountId,
                    });
                    challengeDetected = true;
                    break;
                }

                let mismatch: string | null = null;
                if (lead.status === 'INVITED' && signals.connected) {
                    mismatch = 'invited_but_connected';
                } else if (lead.status === 'INVITED' && !signals.pendingInvite && signals.canConnect) {
                    mismatch = 'invited_but_connect_available';
                } else if (lead.status === 'READY_INVITE' && signals.pendingInvite) {
                    mismatch = 'ready_invite_but_pending';
                } else if (lead.status === 'READY_INVITE' && signals.connected) {
                    mismatch = 'ready_invite_but_connected';
                } else if (lead.status === 'READY_MESSAGE' && signals.pendingInvite) {
                    mismatch = 'ready_message_but_pending_invite';
                } else if (lead.status === 'READY_MESSAGE' && !signals.connected) {
                    mismatch = 'ready_message_but_not_connected';
                } else if (lead.status === 'MESSAGED' && signals.pendingInvite) {
                    mismatch = 'messaged_but_pending_invite';
                } else if (lead.status === 'MESSAGED' && !signals.connected) {
                    mismatch = 'messaged_but_not_connected';
                }

                if (!mismatch) {
                    continue;
                }

                report.mismatches += 1;
                let fixed = false;
                if (options.autoFix) {
                    fixed = await tryAutoFix(lead, mismatch);
                    if (fixed) {
                        report.fixed += 1;
                    }
                }

                report.items.push({
                    leadId: lead.id,
                    status: lead.status,
                    linkedinUrl: lead.linkedin_url,
                    siteSignals: signals,
                    mismatch,
                    fixed,
                });
            }
        } finally {
            await closeBrowser(session);
        }

        if (challengeDetected) {
            break;
        }
    }

    return report;
}
