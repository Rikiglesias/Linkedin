import { checkLogin, closeBrowser, detectChallenge, humanDelay, launchBrowser } from '../browser';
import { config } from '../config';
import { quarantineAccount } from '../risk/incidentManager';
import { logInfo, logWarn } from '../telemetry/logger';
import {
    addLead,
    CompanyTargetRecord,
    getCompanyTargetsForEnrichment,
    setCompanyTargetStatus,
} from './repositories';

export interface CompanyEnrichmentOptions {
    limit?: number;
    maxProfilesPerCompany?: number;
    dryRun?: boolean;
}

export interface CompanyEnrichmentReport {
    scanned: number;
    matched: number;
    createdLeads: number;
    noMatch: number;
    errors: number;
    dryRun: boolean;
}

function normalizeProfileUrl(raw: string): string | null {
    try {
        const parsed = new URL(raw);
        if (!parsed.hostname.toLowerCase().includes('linkedin.com')) return null;
        const path = parsed.pathname.replace(/\/+$/, '');
        if (!path.startsWith('/in/')) return null;
        return `https://www.linkedin.com${path}/`;
    } catch {
        return null;
    }
}

function toTitleCase(input: string): string {
    if (!input) return '';
    return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

function parseNamesFromProfileUrl(profileUrl: string): { firstName: string; lastName: string } {
    try {
        const parsed = new URL(profileUrl);
        const slug = parsed.pathname.replace('/in/', '').replace(/\/+$/, '');
        const clean = slug.replace(/[-_]/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!clean) return { firstName: '', lastName: '' };

        const parts = clean.split(' ').filter((part) => /^[A-Za-zÀ-ÿ]{2,}$/.test(part));
        if (parts.length === 0) return { firstName: '', lastName: '' };
        if (parts.length === 1) return { firstName: toTitleCase(parts[0]), lastName: '' };

        return {
            firstName: toTitleCase(parts[0]),
            lastName: parts.slice(1).map(toTitleCase).join(' '),
        };
    } catch {
        return { firstName: '', lastName: '' };
    }
}

function extractDomain(website: string): string {
    const raw = (website ?? '').trim();
    if (!raw) return '';
    try {
        const parsed = raw.startsWith('http://') || raw.startsWith('https://')
            ? new URL(raw)
            : new URL(`https://${raw}`);
        return parsed.hostname.replace(/^www\./i, '');
    } catch {
        return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    }
}

function buildSearchQuery(target: CompanyTargetRecord): string {
    const company = (target.account_name ?? '').trim();
    const domain = extractDomain(target.website);
    const terms = [company, domain].filter((v) => v.length > 0);
    return terms.join(' ').trim();
}

function buildSearchQueries(target: CompanyTargetRecord): string[] {
    const company = (target.account_name ?? '').trim();
    const domain = extractDomain(target.website);
    const candidates = [
        buildSearchQuery(target),
        company,
        domain,
    ].filter((value) => value.length > 0);

    const unique = new Set<string>();
    for (const value of candidates) {
        unique.add(value);
    }
    return Array.from(unique);
}

async function extractProfileUrls(page: Parameters<typeof detectChallenge>[0], maxProfiles: number): Promise<string[]> {
    const rawUrls = await page.$$eval('a[href*="/in/"]', (anchors) =>
        anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter((href) => !!href)
    );

    const unique = new Set<string>();
    for (const rawUrl of rawUrls) {
        const normalized = normalizeProfileUrl(rawUrl);
        if (!normalized) continue;
        unique.add(normalized);
        if (unique.size >= maxProfiles) break;
    }

    return Array.from(unique);
}

async function processCompanyTarget(
    target: CompanyTargetRecord,
    options: Required<CompanyEnrichmentOptions>,
    page: Parameters<typeof checkLogin>[0]
): Promise<{ matched: boolean; createdLeads: number; noMatch: boolean; error: string | null }> {
    const queries = buildSearchQueries(target);
    if (queries.length === 0) {
        return { matched: false, createdLeads: 0, noMatch: true, error: null };
    }

    let profileUrls: string[] = [];
    for (const query of queries) {
        const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 1700, 3000);

        if (await detectChallenge(page)) {
            await quarantineAccount('COMPANY_ENRICHMENT_CHALLENGE', {
                targetId: target.id,
                listName: target.list_name,
                accountName: target.account_name,
            });
            throw new Error('Challenge rilevato durante enrichment');
        }

        profileUrls = await extractProfileUrls(page, options.maxProfilesPerCompany);
        if (profileUrls.length > 0) {
            break;
        }
    }
    if (profileUrls.length === 0) {
        return { matched: false, createdLeads: 0, noMatch: true, error: null };
    }

    let createdLeads = 0;
    if (!options.dryRun) {
        for (const profileUrl of profileUrls) {
            const names = parseNamesFromProfileUrl(profileUrl);
            const inserted = await addLead({
                accountName: target.account_name,
                firstName: names.firstName,
                lastName: names.lastName,
                jobTitle: '',
                website: target.website,
                linkedinUrl: profileUrl,
                listName: target.list_name,
            });
            if (inserted) {
                createdLeads += 1;
            }
        }
    } else {
        createdLeads = profileUrls.length;
    }

    return { matched: true, createdLeads, noMatch: false, error: null };
}

export async function runCompanyEnrichmentBatch(options: CompanyEnrichmentOptions = {}): Promise<CompanyEnrichmentReport> {
    const resolved: Required<CompanyEnrichmentOptions> = {
        limit: Math.max(1, options.limit ?? config.companyEnrichmentBatch),
        maxProfilesPerCompany: Math.max(1, options.maxProfilesPerCompany ?? config.companyEnrichmentMaxProfilesPerCompany),
        dryRun: options.dryRun ?? false,
    };

    const targets = await getCompanyTargetsForEnrichment(resolved.limit);
    const report: CompanyEnrichmentReport = {
        scanned: 0,
        matched: 0,
        createdLeads: 0,
        noMatch: 0,
        errors: 0,
        dryRun: resolved.dryRun,
    };

    if (targets.length === 0) {
        return report;
    }

    const session = await launchBrowser();
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            await quarantineAccount('COMPANY_ENRICHMENT_LOGIN_MISSING', {
                reason: 'Sessione non autenticata durante enrichment automatico',
            });
            await logWarn('company_enrichment.skipped.login_missing', { targets: targets.length });
            return report;
        }

        for (const target of targets) {
            report.scanned += 1;
            try {
                const result = await processCompanyTarget(target, resolved, session.page);
                if (result.matched) {
                    report.matched += 1;
                    report.createdLeads += result.createdLeads;
                    if (!resolved.dryRun) {
                        await setCompanyTargetStatus(target.id, 'ENRICHED', null);
                    }
                } else if (result.noMatch) {
                    report.noMatch += 1;
                    if (!resolved.dryRun) {
                        await setCompanyTargetStatus(target.id, 'NO_MATCH', null);
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                report.errors += 1;
                if (!resolved.dryRun) {
                    await setCompanyTargetStatus(target.id, 'ERROR', message);
                }
                await logWarn('company_enrichment.target_failed', {
                    targetId: target.id,
                    listName: target.list_name,
                    accountName: target.account_name,
                    error: message,
                });
                if (/challenge/i.test(message)) {
                    break;
                }
            }
        }
    } finally {
        await closeBrowser(session);
    }

    await logInfo('company_enrichment.batch', {
        scanned: report.scanned,
        matched: report.matched,
        createdLeads: report.createdLeads,
        noMatch: report.noMatch,
        errors: report.errors,
        dryRun: report.dryRun,
    });
    return report;
}
