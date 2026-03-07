import { getAccountProfileById } from '../accountManager';
import { checkLogin, closeBrowser, humanDelay, launchBrowser, randomMouseMove, simulateHumanReading } from '../browser';
import { logInfo, logWarn } from '../telemetry/logger';

export interface RandomActivityOptions {
    accountId?: string;
    maxActions: number;
    dryRun: boolean;
}

export interface RandomActivityReport {
    accountId: string;
    dryRun: boolean;
    actionsRequested: number;
    actionsExecuted: number;
    visitedUrls: string[];
    profileVisits: number;
    errors: number;
}

type Activity = 'home' | 'notifications' | 'network' | 'settings' | 'profile_from_page';

const STATIC_ACTIVITY_URLS: Record<Exclude<Activity, 'profile_from_page'>, string> = {
    home: 'https://www.linkedin.com/feed/',
    notifications: 'https://www.linkedin.com/notifications/',
    network: 'https://www.linkedin.com/mynetwork/',
    settings: 'https://www.linkedin.com/mypreferences/d/categories/account',
};

function pickRandom<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

async function extractProfileUrlsFromCurrentPage(page: import('playwright').Page): Promise<string[]> {
    const urls = await page
        .evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
            return anchors
                .map((anchor) => anchor.href || '')
                .filter((href) => /linkedin\.com\/in\//i.test(href))
                .map((href) => href.split('?')[0])
                .slice(0, 20);
        })
        .catch(() => [] as string[]);
    return Array.from(new Set(urls));
}

async function runSingleActivity(
    page: import('playwright').Page,
    activity: Activity,
    report: RandomActivityReport,
): Promise<void> {
    if (activity === 'profile_from_page') {
        const profiles = await extractProfileUrlsFromCurrentPage(page);
        if (profiles.length === 0) {
            return;
        }
        const profileUrl = pickRandom(profiles);
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
        report.visitedUrls.push(profileUrl);
        report.profileVisits += 1;
        await humanDelay(page, 2000, 4200);
        await simulateHumanReading(page);
        return;
    }

    const targetUrl = STATIC_ACTIVITY_URLS[activity];
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    report.visitedUrls.push(targetUrl);
    await humanDelay(page, 1800, 3600);
    await simulateHumanReading(page);

    if (Math.random() < 0.35) {
        await randomMouseMove(page);
    }
}

export async function runRandomLinkedinActivity(options: RandomActivityOptions): Promise<RandomActivityReport> {
    const account = getAccountProfileById(options.accountId);
    const actionsRequested = Math.max(1, options.maxActions);

    const report: RandomActivityReport = {
        accountId: account.id,
        dryRun: options.dryRun,
        actionsRequested,
        actionsExecuted: 0,
        visitedUrls: [],
        profileVisits: 0,
        errors: 0,
    };

    if (options.dryRun) {
        return report;
    }

    await logInfo('random_activity.session_start', {
        accountId: account.id,
        actionsRequested,
    });

    const session = await launchBrowser({
        sessionDir: account.sessionDir,
        proxy: account.proxy,
    });
    try {
        const loggedIn = await checkLogin(session.page);
        if (!loggedIn) {
            await logWarn('random_activity.not_logged_in', { accountId: account.id });
            return report;
        }

        const activityPool: Activity[] = ['home', 'notifications', 'network', 'settings', 'profile_from_page'];

        for (let i = 0; i < actionsRequested; i++) {
            const activity = pickRandom(activityPool);
            try {
                await runSingleActivity(session.page, activity, report);
                report.actionsExecuted += 1;
            } catch (err: unknown) {
                report.errors += 1;
                await logWarn('random_activity.action_failed', {
                    accountId: account.id,
                    activity,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            await humanDelay(session.page, 1200, 2800);
        }

        await logInfo('random_activity.session_done', {
            accountId: account.id,
            actionsExecuted: report.actionsExecuted,
            profileVisits: report.profileVisits,
            errors: report.errors,
        });
        return report;
    } finally {
        await closeBrowser(session);
    }
}
