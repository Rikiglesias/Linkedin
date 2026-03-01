import { getAccountProfileById } from '../accountManager';
import { checkLogin, closeBrowser, detectChallenge, launchBrowser } from '../browser';
import { handleChallengeDetected } from '../risk/incidentManager';
import {
    getLeadByLinkedinUrl,
    linkLeadToSalesNavList,
    markSalesNavListSynced,
    upsertSalesNavList,
    upsertSalesNavigatorLead,
} from './repositories';
import { navigateToSavedLists, scrapeLeadsFromSalesNavList, SalesNavLeadCandidate, SalesNavSavedList } from '../salesnav/listScraper';

export interface SalesNavigatorSyncOptions {
    listName?: string | null;
    listUrl?: string | null;
    maxPages: number;
    maxLeadsPerList: number;
    dryRun: boolean;
    accountId?: string;
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
}

function cleanText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
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
    };

    const session = await launchBrowser({
        sessionDir: account.sessionDir,
        proxy: account.proxy,
    });

    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            throw new Error(`Sales Navigator sync: sessione non autenticata (account=${account.id}).`);
        }

        let targetLists: SalesNavSavedList[] = [];
        if (explicitListUrl) {
            targetLists = [{
                name: listFilter || 'default',
                url: explicitListUrl,
            }];
        } else {
            const discovered = await navigateToSavedLists(session.page);
            report.listDiscoveryCount = discovered.length;
            if (listFilter) {
                targetLists = discovered.filter((entry) => matchesListNameFilter(entry, listFilter));
            } else {
                targetLists = discovered;
            }
        }

        if (targetLists.length === 0) {
            throw new Error('Sales Navigator sync: nessuna lista trovata con i criteri forniti.');
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

                    const upserted = await upsertSalesNavigatorLead({
                        listName,
                        linkedinUrl: candidate.linkedinUrl,
                        accountName: candidate.accountName,
                        firstName: candidate.firstName,
                        lastName: candidate.lastName,
                        jobTitle: candidate.jobTitle,
                        website: candidate.website,
                    });

                    if (listRow && upserted.leadId > 0) {
                        await linkLeadToSalesNavList(listRow.id, upserted.leadId);
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
                } catch {
                    listReport.errors += 1;
                    report.errors += 1;
                }
            }

            if (listRow && !options.dryRun) {
                await markSalesNavListSynced(listRow.id);
            }

            report.lists.push(listReport);
        }

        return report;
    } finally {
        await closeBrowser(session);
    }
}
