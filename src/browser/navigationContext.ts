/**
 * browser/navigationContext.ts
 * ─────────────────────────────────────────────────────────────────
 * Navigation Context Chains (1.2): simula catene di navigazione
 * realistiche per evitare il pattern "goto diretto al profilo"
 * che è il segnale detection #1 per LinkedIn.
 *
 * Catene supportate:
 *   - INVITE: Feed → Search(keywords) → Scroll → Click profilo
 *   - MESSAGE: Feed/Notifiche → Search → Click profilo
 *
 * Ogni step ha humanDelay variabile e overlay re-injection.
 * Se una catena fallisce, NON usa goto diretto al profilo: ritorna failure e
 * lascia al caller decidere retry o skip.
 */

import { Page } from 'playwright';
import { ensureVisualCursorOverlay, ensureInputBlock, humanDelay, simulateHumanReading } from './humanBehavior';
import { clickLocatorHumanLike } from './humanClick';
import { isInputBlockSuspended } from '../salesnav/bulkSaveHelpers';
import { logInfo, logWarn } from '../telemetry/logger';
import { randomInt } from '../utils/random';
import type { NavigationStrategy } from '../core/navigationStrategy';

// ─── Tipi ────────────────────────────────────────────────────────────────────

interface NavigationResult {
    strategy: NavigationStrategy;
    success: boolean;
    stepsCompleted: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Termini generici di settore — usati al 50% al posto delle keywords del lead
// per evitare correlazione diretta search→profilo visitato (pattern detectable).
const GENERIC_SEARCH_TERMS = [
    'marketing manager',
    'software engineer',
    'sales director',
    'product manager',
    'ceo startup',
    'business development',
    'account executive',
    'data analyst',
    'hr manager',
    'operations director',
    'cto',
    'growth hacker',
    'consultant',
    'project manager',
    'designer',
    'recruiter',
    'founder',
    'vp sales',
];

/**
 * Costruisce keywords di ricerca per la catena organica.
 *
 * 50% usa keywords generiche del settore (NON correlate al lead specifico)
 * 50% usa solo il job_title generico (MAI company — troppo specifico)
 *
 * Razionale: un umano non cerca sempre "Marketing Manager Accenture" e poi
 * clicca esattamente quel profilo. A volte naviga risultati generici.
 */
function buildSearchKeywords(lead: {
    name?: string | null;
    job_title?: string | null;
    company?: string | null;
}): string {
    // 50% termini generici — decorrela search da profilo visitato
    if (Math.random() < 0.5) {
        return GENERIC_SEARCH_TERMS[randomInt(0, GENERIC_SEARCH_TERMS.length - 1)];
    }

    // 50% job title generico del lead (senza company, senza nome)
    if (lead.job_title) {
        const titleWords = lead.job_title.split(/\s+/).slice(0, 2).join(' ');
        return titleWords;
    }

    return GENERIC_SEARCH_TERMS[randomInt(0, GENERIC_SEARCH_TERMS.length - 1)];
}

function buildSearchKeywordsForProfile(
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null },
): string {
    if (lead.name?.trim() || lead.job_title?.trim() || lead.company?.trim()) {
        return buildSearchKeywords(lead);
    }

    const slug = profileUrl.match(/\/in\/([^/?#]+)/i)?.[1] ?? '';
    const slugKeywords = slug
        .replace(/[-_]+/g, ' ')
        .replace(/\d+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (slugKeywords.length >= 3) {
        return slugKeywords;
    }

    return GENERIC_SEARCH_TERMS[randomInt(0, GENERIC_SEARCH_TERMS.length - 1)];
}

/**
 * Re-inietta overlay dopo navigazione (il DOM viene distrutto su ogni page load).
 * Rispetta il flag di sospensione globale (durante login manuale).
 */
async function reInjectOverlays(page: Page): Promise<void> {
    // Quando suspended (login manuale in corso), NON iniettare nessun overlay —
    // né il cursore visuale (cursor:none nasconde il mouse reale) né l'input block.
    if (isInputBlockSuspended(page)) {
        return;
    }
    await ensureVisualCursorOverlay(page);
    await ensureInputBlock(page);
}

async function openProfileViaSearchResults(
    page: Page,
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null },
): Promise<{ success: boolean; stepsCompleted: number }> {
    let stepsCompleted = 0;
    const targetSlug = profileUrl.match(/\/in\/([^/?#]+)/i)?.[1]?.toLowerCase();
    if (!targetSlug) {
        return { success: false, stepsCompleted };
    }

    const keywords = buildSearchKeywordsForProfile(profileUrl, lead);
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await reInjectOverlays(page);
    await humanDelay(page, 2000, 4000);
    stepsCompleted++;

    await simulateHumanReading(page);
    await humanDelay(page, 1000, 2500);
    stepsCompleted++;

    const targetLink = page.locator(`a[href*="/in/${targetSlug}"]`).first();
    if (!(await targetLink.isVisible({ timeout: 2000 }).catch(() => false))) {
        await logWarn('navigation_context.target_not_found_in_search_results', {
            profileSlug: targetSlug,
            keywords: keywords.substring(0, 80),
        });
        return { success: false, stepsCompleted };
    }

    await humanDelay(page, 400, 1200);
    await clickLocatorHumanLike(page, targetLink, {
        selectorForDwell: `a[href*="/in/${targetSlug}"]`,
        scrollTimeoutMs: 5000,
    });
    await page.waitForURL('**/in/**', { timeout: 10_000 }).catch(() => null);
    await reInjectOverlays(page);

    return { success: true, stepsCompleted: stepsCompleted + 1 };
}

// ─── Catena Organica: Search ─────────────────────────────────────────────────

/**
 * Simula: Feed → Search people → Scroll risultati → Arrivo al profilo.
 * Un umano reale cerca qualcuno su LinkedIn prima di visitare il profilo.
 */
async function navigateViaOrganicSearch(
    page: Page,
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null },
): Promise<NavigationResult> {
    let stepsCompleted = 0;

    try {
        // Step 1: Vai al feed (punto di partenza naturale)
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await reInjectOverlays(page);
        await humanDelay(page, 1500, 3500);
        stepsCompleted++;

        const searchResult = await openProfileViaSearchResults(page, profileUrl, lead);
        stepsCompleted += searchResult.stepsCompleted;
        return { strategy: 'search_organic', success: searchResult.success, stepsCompleted };
    } catch {
        return { strategy: 'search_organic', success: false, stepsCompleted };
    }
}

// ─── Catena Organica: Feed ───────────────────────────────────────────────────

/**
 * Simula: Feed → Scroll → Click sul profilo.
 * Variante più leggera della catena search.
 */
async function navigateViaOrganicFeed(
    page: Page,
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null } = {},
): Promise<NavigationResult> {
    let stepsCompleted = 0;

    try {
        // Step 1: Vai al feed
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await reInjectOverlays(page);
        await humanDelay(page, 1500, 3000);
        stepsCompleted++;

        // Step 2: Scroll il feed (simula browsing naturale)
        await simulateHumanReading(page);
        await humanDelay(page, 800, 2000);
        stepsCompleted++;

        const searchResult = await openProfileViaSearchResults(page, profileUrl, lead);
        stepsCompleted += searchResult.stepsCompleted;
        return { strategy: 'feed_organic', success: searchResult.success, stepsCompleted };
    } catch {
        return { strategy: 'feed_organic', success: false, stepsCompleted };
    }
}

async function navigateViaDirectSearchResults(
    page: Page,
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null } = {},
): Promise<NavigationResult> {
    try {
        const searchResult = await openProfileViaSearchResults(page, profileUrl, lead);
        return {
            strategy: 'direct',
            success: searchResult.success,
            stepsCompleted: searchResult.stepsCompleted,
        };
    } catch {
        return { strategy: 'direct', success: false, stepsCompleted: 0 };
    }
}

async function navigateByStrategy(
    page: Page,
    strategy: NavigationStrategy,
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null },
): Promise<NavigationResult> {
    switch (strategy) {
        case 'feed_organic':
            return navigateViaOrganicFeed(page, profileUrl, lead);
        case 'direct':
            return navigateViaDirectSearchResults(page, profileUrl, lead);
        case 'search_organic':
        default:
            return navigateViaOrganicSearch(page, profileUrl, lead);
    }
}

function buildFallbackChain(preferredStrategy: NavigationStrategy): NavigationStrategy[] {
    switch (preferredStrategy) {
        case 'feed_organic':
            return ['feed_organic', 'search_organic', 'direct'];
        case 'direct':
            return ['direct', 'search_organic', 'feed_organic'];
        case 'search_organic':
        default:
            return ['search_organic', 'feed_organic', 'direct'];
    }
}

// ─── API Pubblica ────────────────────────────────────────────────────────────

/**
 * Naviga al profilo di un lead con catena di contesto realistica.
 *
 * Distribuzione probabilistica CON DECAY:
 *   - Le probabilità di catena search/feed cambiano con l'avanzare della sessione.
 *   - Nessun ramo usa goto diretto al profilo target.
 *
 * Razionale: un umano può essere più o meno organico, ma il nostro automation
 * layer non deve teletrasportarsi direttamente al profilo target.
 */
export async function navigateToProfileWithContext(
    page: Page,
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null },
    accountId: string,
    sessionInviteCount: number = 0,
    preferredStrategy?: NavigationStrategy,
): Promise<NavigationResult> {
    if (preferredStrategy) {
        for (const strategy of buildFallbackChain(preferredStrategy)) {
            const result = await navigateByStrategy(page, strategy, profileUrl, lead);
            if (result.success) {
                await logInfo('navigation_context.profile_arrived', {
                    accountId,
                    strategy: result.strategy,
                    stepsCompleted: result.stepsCompleted,
                });
                return result;
            }
        }

        const failed = { strategy: preferredStrategy, success: false, stepsCompleted: 0 } satisfies NavigationResult;
        await logInfo('navigation_context.profile_arrived', {
            accountId,
            strategy: failed.strategy,
            stepsCompleted: failed.stepsCompleted,
        });
        return failed;
    }

    // Decay: probabilità catena organica cala con la sessione
    let searchProb: number;
    let feedProb: number;
    if (sessionInviteCount < 5) {
        searchProb = 0.45;
        feedProb = 0.25;
    } else if (sessionInviteCount < 15) {
        searchProb = 0.25;
        feedProb = 0.2;
    } else {
        searchProb = 0.1;
        feedProb = 0.1;
    }

    const roll = Math.random();
    let result: NavigationResult;

    if (roll < searchProb) {
        // Catena search organica
        result = await navigateViaOrganicSearch(page, profileUrl, lead);
        if (!result.success) {
            await logWarn('navigation_context.organic_search_failed', {
                accountId,
                stepsCompleted: result.stepsCompleted,
                profileUrl: profileUrl.substring(0, 60),
            });
            result = await navigateViaOrganicFeed(page, profileUrl, lead);
        }
    } else if (roll < searchProb + feedProb) {
        // Catena feed organica (probabilità con decay)
        result = await navigateViaOrganicFeed(page, profileUrl, lead);
        if (!result.success) {
            await logWarn('navigation_context.organic_feed_failed', {
                accountId,
                stepsCompleted: result.stepsCompleted,
                profileUrl: profileUrl.substring(0, 60),
            });
            result = await navigateViaOrganicSearch(page, profileUrl, lead);
        }
    } else {
        result = await navigateViaOrganicSearch(page, profileUrl, lead);
        if (!result.success) {
            await logWarn('navigation_context.organic_search_retry_failed', {
                accountId,
                stepsCompleted: result.stepsCompleted,
                profileUrl: profileUrl.substring(0, 60),
            });
            result = await navigateViaOrganicFeed(page, profileUrl, lead);
        }
    }

    await logInfo('navigation_context.profile_arrived', {
        accountId,
        strategy: result.strategy,
        stepsCompleted: result.stepsCompleted,
    });

    return result;
}

/**
 * Naviga al profilo per azioni leggere (acceptance check, view, like, follow).
 *
 * Distribuzione:
 *   - 40%: Feed → Search → Profilo
 *   - 30%: Notifiche → Search → Profilo
 *   - 30%: Search diretta ma sempre via risultati
 *
 * Più leggera della catena invite (niente search), perché queste azioni
 * sono tipicamente post-invito: l'umano controlla se hanno accettato.
 */
export async function navigateToProfileForCheck(
    page: Page,
    profileUrl: string,
    accountId: string,
): Promise<NavigationResult> {
    const roll = Math.random();
    let result: NavigationResult;

    if (roll < 0.4) {
        try {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            await humanDelay(page, 1200, 2800);
            await simulateHumanReading(page);
            const searchResult = await openProfileViaSearchResults(page, profileUrl, {});
            result = {
                strategy: 'feed_organic',
                success: searchResult.success,
                stepsCompleted: 2 + searchResult.stepsCompleted,
            };
        } catch {
            result = { strategy: 'feed_organic', success: false, stepsCompleted: 1 };
        }
    } else if (roll < 0.7) {
        try {
            await page.goto('https://www.linkedin.com/notifications/', {
                waitUntil: 'domcontentloaded',
                timeout: 10_000,
            });
            await reInjectOverlays(page);
            await humanDelay(page, 1500, 3000);
            const searchResult = await openProfileViaSearchResults(page, profileUrl, {});
            result = {
                strategy: 'feed_organic',
                success: searchResult.success,
                stepsCompleted: 2 + searchResult.stepsCompleted,
            };
        } catch {
            result = { strategy: 'feed_organic', success: false, stepsCompleted: 1 };
        }
    } else {
        const searchResult = await openProfileViaSearchResults(page, profileUrl, {});
        result = {
            strategy: 'direct',
            success: searchResult.success,
            stepsCompleted: searchResult.stepsCompleted,
        };
    }

    await logInfo('navigation_context.check_profile_arrived', {
        accountId,
        strategy: result.strategy,
        stepsCompleted: result.stepsCompleted,
    });

    return result;
}

/**
 * R04: Funzione di navigazione UNIFICATA per tutti i worker.
 * Sostituisce i 3 metodi separati (navigateToProfileWithContext, ForCheck, ForMessage)
 * con un'unica funzione che sceglie la strategia in base a `purpose` e `sessionActionCount`.
 *
 * Purpose → Strategia:
 *   - 'invite':    search organic + feed organic
 *   - 'message':   feed/notifiche + ricerca profilo nei risultati
 *   - 'check':     feed/notifiche + ricerca profilo nei risultati
 *   - 'follow_up': simile a message
 *
 * sessionActionCount abilita il decay (primi inviti → più search organica, poi → più feed/search leggere).
 * Se non fornito, usa decay 0 (tutti i profili con stesse probabilità).
 */
export async function navigateToProfile(
    page: Page,
    profileUrl: string,
    options: {
        purpose: 'invite' | 'message' | 'check' | 'follow_up';
        lead?: { name?: string | null; job_title?: string | null; company?: string | null };
        accountId: string;
        sessionActionCount?: number;
        preferredStrategy?: NavigationStrategy;
    },
): Promise<NavigationResult> {
    const { purpose, lead, accountId, sessionActionCount = 0, preferredStrategy } = options;

    if (purpose === 'invite') {
        return navigateToProfileWithContext(page, profileUrl, lead ?? {}, accountId, sessionActionCount, preferredStrategy);
    }

    if (purpose === 'check') {
        return navigateToProfileForCheck(page, profileUrl, accountId);
    }

    // 'message' e 'follow_up' usano la stessa logica
    return navigateToProfileForMessage(page, profileUrl, accountId, preferredStrategy);
}

export async function navigateToProfileForMessage(
    page: Page,
    profileUrl: string,
    accountId: string,
    preferredStrategy?: NavigationStrategy,
): Promise<NavigationResult> {
    if (preferredStrategy) {
        for (const strategy of buildFallbackChain(preferredStrategy)) {
            const result = await navigateByStrategy(page, strategy, profileUrl, {});
            if (result.success) {
                await logInfo('navigation_context.message_profile_arrived', {
                    accountId,
                    strategy: result.strategy,
                    stepsCompleted: result.stepsCompleted,
                });
                return result;
            }
        }

        const failed = { strategy: preferredStrategy, success: false, stepsCompleted: 0 } satisfies NavigationResult;
        await logInfo('navigation_context.message_profile_arrived', {
            accountId,
            strategy: failed.strategy,
            stepsCompleted: failed.stepsCompleted,
        });
        return failed;
    }

    const roll = Math.random();
    let result: NavigationResult;

    if (roll < 0.6) {
        // 60%: Feed/Notifiche → Search → Profilo
        try {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            await humanDelay(page, 1200, 2800);

            // 40% di probabilità: check notifiche prima (umano vede notifica di accettazione)
            if (Math.random() < 0.4) {
                await page.goto('https://www.linkedin.com/notifications/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 10_000,
                });
                await reInjectOverlays(page);
                await humanDelay(page, 1500, 3000);
            }

            const searchResult = await openProfileViaSearchResults(page, profileUrl, {});
            result = {
                strategy: 'feed_organic',
                success: searchResult.success,
                stepsCompleted: 2 + searchResult.stepsCompleted,
            };
        } catch {
            result = { strategy: 'feed_organic', success: false, stepsCompleted: 1 };
        }
    } else {
        const searchResult = await openProfileViaSearchResults(page, profileUrl, {});
        result = {
            strategy: 'direct',
            success: searchResult.success,
            stepsCompleted: searchResult.stepsCompleted,
        };
    }

    await logInfo('navigation_context.message_profile_arrived', {
        accountId,
        strategy: result.strategy,
        stepsCompleted: result.stepsCompleted,
    });

    return result;
}
