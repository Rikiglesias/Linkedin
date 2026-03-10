/**
 * linkedinProfileScraper.ts — Extract verified data from LinkedIn profile pages
 *
 * Supports both public profiles (/in/) and SalesNav lead pages (/sales/lead/).
 * Only reads DOM — no clicks, no interactions, no writes.
 * Anti-detection: human delays, passive reading only.
 */

import type { Page } from 'playwright';
import { humanDelay, simulateHumanReading } from './index';
import { logInfo, logWarn } from '../telemetry/logger';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface LinkedinProfileData {
    headline: string | null;
    currentTitle: string | null;
    currentCompany: string | null;
    location: string | null;
    about: string | null;
    publicProfileUrl: string | null;
    source: 'linkedin_profile' | 'salesnav_profile';
}

// ─── Public Profile Scraper (/in/) ──────────────────────────────────────────────

export async function scrapeLinkedinProfile(
    page: Page,
    profileUrl: string,
): Promise<LinkedinProfileData | null> {
    if (!profileUrl || !profileUrl.includes('/in/')) return null;

    try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await humanDelay(page, 1500, 3000);
        await simulateHumanReading(page);

        const data = await page.evaluate(() => {
            const getText = (sel: string): string | null => {
                const el = document.querySelector(sel);
                const text = el?.textContent?.trim();
                return text || null;
            };

            const headline =
                getText('.text-body-medium.break-words') ||
                getText('div.text-body-medium') ||
                null;

            const location =
                getText('.text-body-small.inline.t-black--light.break-words') ||
                getText('span.text-body-small.inline') ||
                null;

            const about =
                getText('#about ~ div .inline-show-more-text span[aria-hidden="true"]') ||
                getText('#about ~ div .display-flex span[aria-hidden="true"]') ||
                null;

            let currentTitle: string | null = null;
            let currentCompany: string | null = null;

            const expSection = document.querySelector('#experience');
            if (expSection) {
                const expContainer = expSection.closest('section');
                if (expContainer) {
                    const firstExp = expContainer.querySelector('.pvs-entity, li.artdeco-list__item');
                    if (firstExp) {
                        const titleEl = firstExp.querySelector(
                            '.t-bold span[aria-hidden="true"], .mr1.t-bold span[aria-hidden="true"]',
                        );
                        currentTitle = titleEl?.textContent?.trim() || null;

                        const subtitleEl = firstExp.querySelector(
                            '.t-14.t-normal span[aria-hidden="true"]',
                        );
                        let company = subtitleEl?.textContent?.trim() || null;
                        if (company) {
                            company = company.split('·')[0]?.trim() || company;
                        }
                        currentCompany = company;
                    }
                }
            }

            return { headline, currentTitle, currentCompany, location, about };
        });

        await logInfo('linkedin_profile.scraped', {
            url: profileUrl,
            hasHeadline: !!data.headline,
            hasTitle: !!data.currentTitle,
            hasCompany: !!data.currentCompany,
        });

        return { ...data, publicProfileUrl: profileUrl, source: 'linkedin_profile' as const };
    } catch (err) {
        await logWarn('linkedin_profile.scrape_failed', {
            url: profileUrl,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

// ─── SalesNav Lead Page Scraper (/sales/lead/) ──────────────────────────────────

/**
 * Scrape profile data from a SalesNav lead detail page.
 * These pages show headline, current role, company, location, and a link
 * to the public profile (/in/ URL).
 */
export async function scrapeSalesNavProfile(
    page: Page,
    salesNavUrl: string,
): Promise<LinkedinProfileData | null> {
    if (!salesNavUrl || !salesNavUrl.includes('/sales/lead/')) return null;

    try {
        await page.goto(salesNavUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await humanDelay(page, 2000, 4000);
        await simulateHumanReading(page);

        const data = await page.evaluate(() => {
            const getText = (sel: string): string | null => {
                const el = document.querySelector(sel);
                const text = el?.textContent?.trim();
                return text || null;
            };

            // SalesNav lead page selectors
            // Headline/title — often in the top card area
            const headline =
                getText('[data-x--lead--headline]') ||
                getText('.profile-topcard__summary-position') ||
                getText('.top-card__headline') ||
                getText('.artdeco-entity-lockup__subtitle') ||
                null;

            // Current company
            let currentCompany =
                getText('[data-x--lead--current-company-name]') ||
                getText('.profile-topcard__summary-position-company') ||
                getText('.top-card__company-name') ||
                null;

            // Current title — SalesNav shows "Title at Company" or separate
            let currentTitle =
                getText('[data-x--lead--current-position-title]') ||
                getText('.profile-topcard__summary-position-title') ||
                getText('.top-card__title') ||
                null;

            // Fallback: parse "Title at Company" pattern from headline
            if (headline && !currentTitle) {
                const atMatch = headline.match(/^(.+?)\s+(?:at|@|presso|chez|bei|bij)\s+(.+)$/i);
                if (atMatch) {
                    currentTitle = atMatch[1]?.trim() || null;
                    if (!currentCompany) currentCompany = atMatch[2]?.trim() || null;
                }
            }

            // Location
            const location =
                getText('[data-x--lead--location]') ||
                getText('.profile-topcard__location-data') ||
                getText('.top-card__location') ||
                null;

            // About/summary
            const about =
                getText('.profile-topcard__summary-text') ||
                getText('[data-x--lead--summary]') ||
                null;

            // Public /in/ URL link — SalesNav has a "View LinkedIn profile" link
            let publicProfileUrl: string | null = null;
            const profileLinks = Array.from(document.querySelectorAll('a[href]'));
            for (const a of profileLinks) {
                const href = (a as HTMLAnchorElement).href || '';
                if (/linkedin\.com\/in\//i.test(href)) {
                    publicProfileUrl = href.split('?')[0] || null;
                    break;
                }
            }

            // Clean connection degree noise from company/title
            const degreeRe = /^[1-4]°$|collegamento di \d+° grado|\d+(?:st|nd|rd|th) degree/i;
            if (currentCompany && degreeRe.test(currentCompany)) currentCompany = null;
            if (currentTitle && degreeRe.test(currentTitle)) currentTitle = null;

            return { headline, currentTitle, currentCompany, location, about, publicProfileUrl };
        });

        await logInfo('salesnav_profile.scraped', {
            url: salesNavUrl,
            hasHeadline: !!data.headline,
            hasTitle: !!data.currentTitle,
            hasCompany: !!data.currentCompany,
            hasPublicUrl: !!data.publicProfileUrl,
        });

        return { ...data, source: 'salesnav_profile' as const };
    } catch (err) {
        await logWarn('salesnav_profile.scrape_failed', {
            url: salesNavUrl,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}
