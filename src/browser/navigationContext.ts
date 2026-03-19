/**
 * browser/navigationContext.ts
 * ─────────────────────────────────────────────────────────────────
 * Navigation Context Chains (1.2): simula catene di navigazione
 * realistiche per evitare il pattern "goto diretto al profilo"
 * che è il segnale detection #1 per LinkedIn.
 *
 * Catene supportate:
 *   - INVITE: Feed → Search(keywords) → Scroll → Click profilo (70%) | Diretto (30%)
 *   - MESSAGE: Feed → Messaging inbox → Conversazione (60%) | Diretto (40%)
 *
 * Ogni step ha humanDelay variabile e overlay re-injection.
 * Se una catena fallisce, fallback silenzioso a goto diretto.
 */

import { Page } from 'playwright';
import {
    ensureVisualCursorOverlay,
    ensureInputBlock,
    humanDelay,
    simulateHumanReading,
} from './humanBehavior';
import { isInputBlockSuspended } from '../salesnav/bulkSaveHelpers';
import { logInfo, logWarn } from '../telemetry/logger';
import { randomInt } from '../utils/random';

// ─── Tipi ────────────────────────────────────────────────────────────────────

type NavigationStrategy = 'organic_search' | 'organic_feed' | 'direct';

interface NavigationResult {
    strategy: NavigationStrategy;
    success: boolean;
    stepsCompleted: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Termini generici di settore — usati al 50% al posto delle keywords del lead
// per evitare correlazione diretta search→profilo visitato (pattern detectable).
const GENERIC_SEARCH_TERMS = [
    'marketing manager', 'software engineer', 'sales director', 'product manager',
    'ceo startup', 'business development', 'account executive', 'data analyst',
    'hr manager', 'operations director', 'cto', 'growth hacker', 'consultant',
    'project manager', 'designer', 'recruiter', 'founder', 'vp sales',
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
function buildSearchKeywords(lead: { name?: string | null; job_title?: string | null; company?: string | null }): string {
    // 50% termini generici — decorrela search da profilo visitato
    if (Math.random() < 0.50) {
        return GENERIC_SEARCH_TERMS[randomInt(0, GENERIC_SEARCH_TERMS.length - 1)];
    }

    // 50% job title generico del lead (senza company, senza nome)
    if (lead.job_title) {
        const titleWords = lead.job_title.split(/\s+/).slice(0, 2).join(' ');
        return titleWords;
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

        // Step 2: Fai una ricerca people con keywords dal lead
        const keywords = buildSearchKeywords(lead);
        const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await reInjectOverlays(page);
        await humanDelay(page, 2000, 4000);
        stepsCompleted++;

        // Step 3: Scroll i risultati di ricerca (simula lettura lista)
        await simulateHumanReading(page);
        await humanDelay(page, 1000, 2500);
        stepsCompleted++;

        // R08: Tenta di cliccare un risultato REALE nella lista di ricerca.
        // Se il profilo target è nei risultati → click diretto (referrer /search/ coerente).
        // Se non trovato → click un risultato qualsiasi (simula curiosità) → poi naviga al target.
        // Fallback: torna al feed e poi goto diretto (H02 fix originale).
        let clickedSearchResult = false;
        try {
            // Estrai lo slug dal profileUrl (es. /in/mario-rossi/ → mario-rossi)
            const slugMatch = profileUrl.match(/\/in\/([^/?#]+)/);
            const targetSlug = slugMatch?.[1]?.toLowerCase();

            // Cerca il profilo target nei risultati
            if (targetSlug) {
                const targetLink = page.locator(`a[href*="/in/${targetSlug}"]`).first();
                if (await targetLink.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await humanDelay(page, 400, 1200);
                    await targetLink.click({ timeout: 5000 });
                    await page.waitForURL('**/in/**', { timeout: 10_000 }).catch(() => null);
                    await reInjectOverlays(page);
                    clickedSearchResult = true;
                    stepsCompleted++;
                    await logInfo('navigation_context.r08_clicked_target_in_results', {
                        targetSlug,
                    });
                }
            }

            // Se target non trovato, click un risultato random (30% — simula curiosità umana)
            if (!clickedSearchResult && Math.random() < 0.30) {
                const anyResult = page.locator('a[href*="/in/"]').nth(randomInt(0, 4));
                if (await anyResult.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await humanDelay(page, 600, 1500);
                    await anyResult.click({ timeout: 5000 });
                    await page.waitForTimeout(2000 + Math.floor(Math.random() * 3000));
                    await reInjectOverlays(page);
                    // Dopo aver visitato un profilo random, torna indietro e poi vai al target
                    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null);
                    await humanDelay(page, 500, 1500);
                    stepsCompleted++;
                }
            }
        } catch {
            // Best-effort R08 — fallback al comportamento H02
        }

        if (!clickedSearchResult) {
            // H02 fallback: torna al feed → poi goto profilo (referrer = /feed/)
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            await humanDelay(page, 800, 2000);
            stepsCompleted++;

            await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            stepsCompleted++;
        }

        return { strategy: 'organic_search', success: true, stepsCompleted };
    } catch {
        // Se qualsiasi step fallisce, fallback a diretto
        return { strategy: 'organic_search', success: false, stepsCompleted };
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

        // Step 3: Naviga al profilo (come se avessimo cliccato su un post del target)
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await reInjectOverlays(page);
        stepsCompleted++;

        return { strategy: 'organic_feed', success: true, stepsCompleted };
    } catch {
        return { strategy: 'organic_feed', success: false, stepsCompleted };
    }
}

// ─── API Pubblica ────────────────────────────────────────────────────────────

/**
 * Naviga al profilo di un lead con catena di contesto realistica.
 *
 * Distribuzione probabilistica CON DECAY:
 *   - Le probabilità di catena organica CALANO con l'avanzare della sessione.
 *   - Primi 5 inviti: 45% search, 25% feed, 30% diretto
 *   - Inviti 6-15: 25% search, 20% feed, 55% diretto
 *   - Inviti 16+: 10% search, 10% feed, 80% diretto
 *
 * Razionale: un umano i primi profili li cerca, poi va sempre più diretto
 * perché ha già i tab aperti, la cronologia, i bookmark.
 */
export async function navigateToProfileWithContext(
    page: Page,
    profileUrl: string,
    lead: { name?: string | null; job_title?: string | null; company?: string | null },
    accountId: string,
    sessionInviteCount: number = 0,
): Promise<NavigationResult> {
    // Decay: probabilità catena organica cala con la sessione
    let searchProb: number;
    let feedProb: number;
    if (sessionInviteCount < 5) {
        searchProb = 0.45;
        feedProb = 0.25;
    } else if (sessionInviteCount < 15) {
        searchProb = 0.25;
        feedProb = 0.20;
    } else {
        searchProb = 0.10;
        feedProb = 0.10;
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
            // Fallback a diretto
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
            await reInjectOverlays(page);
            result = { strategy: 'direct', success: true, stepsCompleted: 1 };
        }
    } else if (roll < searchProb + feedProb) {
        // Catena feed organica (probabilità con decay)
        result = await navigateViaOrganicFeed(page, profileUrl);
        if (!result.success) {
            await logWarn('navigation_context.organic_feed_failed', {
                accountId,
                stepsCompleted: result.stepsCompleted,
                profileUrl: profileUrl.substring(0, 60),
            });
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
            await reInjectOverlays(page);
            result = { strategy: 'direct', success: true, stepsCompleted: 1 };
        }
    } else {
        // 30%: diretto (bookmark, notifica, URL copiato — comportamento umano legittimo)
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
        await reInjectOverlays(page);
        result = { strategy: 'direct', success: true, stepsCompleted: 1 };
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
 *   - 40%: Feed → Profilo (simula browsing e poi check)
 *   - 30%: Notifiche → Profilo (simula "ho visto notifica, vado a controllare")
 *   - 30%: Diretto (da tab aperto, bookmark, link copiato)
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

    if (roll < 0.40) {
        try {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            await humanDelay(page, 1200, 2800);
            await simulateHumanReading(page);
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            result = { strategy: 'organic_feed', success: true, stepsCompleted: 2 };
        } catch {
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
            await reInjectOverlays(page);
            result = { strategy: 'direct', success: true, stepsCompleted: 1 };
        }
    } else if (roll < 0.70) {
        try {
            await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
            await reInjectOverlays(page);
            await humanDelay(page, 1500, 3000);
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            result = { strategy: 'organic_feed', success: true, stepsCompleted: 2 };
        } catch {
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
            await reInjectOverlays(page);
            result = { strategy: 'direct', success: true, stepsCompleted: 1 };
        }
    } else {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
        await reInjectOverlays(page);
        result = { strategy: 'direct', success: true, stepsCompleted: 1 };
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
 *   - 'invite':    search organic (con decay) + feed + diretto (come navigateToProfileWithContext)
 *   - 'message':   feed (60%) + notifiche (24%) + diretto (16%) — post-accettazione
 *   - 'check':     feed (40%) + notifiche (30%) + diretto (30%) — verifica leggera
 *   - 'follow_up': feed (50%) + notifiche (20%) + diretto (30%) — simile a message ma più cauto
 *
 * sessionActionCount abilita il decay (primi inviti → search organica, poi → sempre più diretto).
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
    },
): Promise<NavigationResult> {
    const { purpose, lead, accountId, sessionActionCount = 0 } = options;

    if (purpose === 'invite') {
        return navigateToProfileWithContext(page, profileUrl, lead ?? {}, accountId, sessionActionCount);
    }

    if (purpose === 'check') {
        return navigateToProfileForCheck(page, profileUrl, accountId);
    }

    // 'message' e 'follow_up' usano la stessa logica
    return navigateToProfileForMessage(page, profileUrl, accountId);
}

export async function navigateToProfileForMessage(
    page: Page,
    profileUrl: string,
    accountId: string,
): Promise<NavigationResult> {
    const roll = Math.random();
    let result: NavigationResult;

    if (roll < 0.60) {
        // 60%: Feed → Profilo (simula "ho visto che ha accettato, vado a scrivergli")
        try {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            await humanDelay(page, 1200, 2800);

            // 40% di probabilità: check notifiche prima (umano vede notifica di accettazione)
            if (Math.random() < 0.40) {
                await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
                await reInjectOverlays(page);
                await humanDelay(page, 1500, 3000);
            }

            await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            await reInjectOverlays(page);
            result = { strategy: 'organic_feed', success: true, stepsCompleted: 3 };
        } catch {
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
            await reInjectOverlays(page);
            result = { strategy: 'direct', success: true, stepsCompleted: 1 };
        }
    } else {
        // 40%: Diretto (da link, bookmark, o notifica mobile)
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
        await reInjectOverlays(page);
        result = { strategy: 'direct', success: true, stepsCompleted: 1 };
    }

    await logInfo('navigation_context.message_profile_arrived', {
        accountId,
        strategy: result.strategy,
        stepsCompleted: result.stepsCompleted,
    });

    return result;
}
