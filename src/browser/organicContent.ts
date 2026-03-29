import { Page } from 'playwright';
// Dynamic import per rompere circular dep humanBehavior↔organicContent
// Le funzioni vengono caricate lazy quando servono (mai al boot)
async function _hb() {
    return import('./humanBehavior');
}
import { logInfo, logWarn } from '../telemetry/logger';
import { randomInt, randomElement } from '../utils/random';

/**
 * Modulo per l'Interazione Organica sui contenuti del Feed LinkedIn.
 * Viene richiamato durante le azioni decoy per simulare un reale interesse
 * (es. mettendo un Like casuale o espandendo il testo di un post tramite "See more").
 *
 * @param page Oggetto Page di Playwright
 * @param probability Probabilità di eseguire un'interazione (es. 0.20 per 20%)
 */
export async function interactWithFeed(page: Page, probability: number = 0.2): Promise<void> {
    try {
        // Valuta la threshold di esecuzione
        if (Math.random() > probability) {
            return; // Nessuna interazione stavolta, comportamento passivo (organico)
        }

        await logInfo('organicContent.start', {});

        // Scroll iniziale per popolare potenziali post
        await (await _hb()).simulateHumanReading(page);

        // Seleziona un post a caso o un bottone di reazione / "See more"
        const actions = [async () => reactToPost(page), async () => expandPostText(page)];

        const action = randomElement(actions);
        await action();

        await logInfo('organicContent.done', {});
    } catch (error) {
        await logWarn('organicContent.error', { error: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * Tenta di espandere il testo lungo di un post cliccando su "See more" / "Vedi altro".
 */
async function expandPostText(page: Page): Promise<void> {
    // Selettori noti per LinkedIn "See more"
    const seeMoreSelectors = [
        'button.feed-shared-inline-show-more-text__see-more-less-toggle',
        'button:has-text("See more")',
        'button:has-text("Vedi altro")',
    ];

    for (const selector of seeMoreSelectors) {
        const buttons = await page.$$(selector);

        // Filtriamo bottoni visibili nel viewport
        const visibleButtons = [];
        for (const btn of buttons) {
            const isVisible = await btn.isVisible();
            if (isVisible) visibleButtons.push(btn);
        }

        if (visibleButtons.length > 0) {
            const targetBtn = randomElement(visibleButtons);
            const box = await targetBtn.boundingBox();

            if (box) {
                // Muove human-like sul bottone
                const targetX = box.x + box.width / 2;
                const targetY = box.y + box.height / 2;
                await (await _hb()).humanMouseMoveToCoords(page, targetX, targetY);

                // Pausa pre-click (Hover ratio decoy - AD-03 partial overlap)
                await (await _hb()).humanDelay(page, 300, 800);

                await targetBtn.click({ delay: randomInt(30, 80) });
                await logInfo('organicContent.expandPost', {});

                // Legge il post espanso
                await (await _hb()).humanDelay(page, 1500, 4000);
                return; // Fatto
            }
        }
    }
}

// M17: Parole chiave che indicano contenuto politico, controverso o non-professionale.
// Un professionista che fa outreach non mette like a post divisivi — riduce rischio reputazionale.
const CONTROVERSIAL_KEYWORDS = [
    'politic',
    'election',
    'voting',
    'democrat',
    'republican',
    'liberal',
    'conservative',
    'abortion',
    'gun control',
    'immigration ban',
    'death penalty',
    'capital punishment',
    'conspiracy',
    'antivax',
    'anti-vax',
    'flat earth',
    'qanon',
    'religion',
    'pray',
    'church',
    'mosque',
    'bible',
    'quran',
    'racist',
    'sexist',
    'homophob',
    'transphob',
    'hate speech',
    'guerra',
    'elezioni',
    'partito',
    'destra',
    'sinistra',
    'fascis',
    'comunis',
    'razzis',
    'sessist',
    'omofob',
] as const;

/**
 * M17: Verifica se il testo di un post contiene contenuto controverso/non-professionale.
 * Ritorna true se il post è sicuro per interazione.
 */
function isPostSafeForInteraction(postText: string): boolean {
    const lower = postText.toLowerCase();
    return !CONTROVERSIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Tenta di lasciare una Reazione (Like, Celebrate, Insightful) su un post visibile.
 */
async function reactToPost(page: Page): Promise<void> {
    // Selettori robusti LinkedIn Feed Reactions
    const reactionSelectors = [
        'button.react-button__trigger',
        'button[aria-label^="React"]',
        'button[aria-label^="Reagisci"]',
        'button[data-control-name="like_toggle"]',
    ];

    for (const selector of reactionSelectors) {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) continue;
        if (!(await locator.isVisible().catch(() => false))) continue;

        // M17: Leggi il testo del post parent prima di reagire.
        // Se contiene contenuto politico/controverso, skip — non mettere like.
        try {
            const postContainer = page
                .locator(selector)
                .first()
                .locator('xpath=ancestor::div[contains(@class,"feed-shared-update-v2")]')
                .first();
            const postText = (await postContainer.textContent({ timeout: 2000 }).catch(() => '')) ?? '';
            if (!isPostSafeForInteraction(postText)) {
                await logInfo('organicContent.skipped_controversial', { excerpt: postText.substring(0, 60) });
                return; // Skip — non reagire a questo post
            }
        } catch {
            // Se non riusciamo a leggere il post, prosegui (best-effort filter)
        }

        const box = await locator.boundingBox();
        if (!box) continue;

        const targetX = box.x + box.width / 2;
        const targetY = box.y + box.height / 2;
        await (await _hb()).humanMouseMoveToCoords(page, targetX, targetY);

        // Pausa pre-click
        await (await _hb()).humanDelay(page, 300, 600);

        // Scelta: Simple click (Like) o Hovering (React Selector)
        if (Math.random() > 0.6) {
            // Hover via locator per aprire il popover CSS delle reactions
            await locator.hover();
            await (await _hb()).humanDelay(page, 800, 1200);

            // Cerca il menu reactions
            const reactionLocator = page.locator('.reactions-menu__reaction');
            const reactionCount = await reactionLocator.count();
            if (reactionCount > 0) {
                const reactionIndex = randomInt(0, reactionCount - 1);
                const specificReaction = reactionLocator.nth(reactionIndex);
                const rBox = await specificReaction.boundingBox();
                if (rBox) {
                    await (await _hb()).humanMouseMoveToCoords(page, rBox.x + rBox.width / 2, rBox.y + rBox.height / 2);
                    await (await _hb()).humanDelay(page, 200, 500);
                    await specificReaction.click({ delay: randomInt(40, 90) });
                    // NEW-12: Dwell time post-reaction (osserva conteggio reazioni)
                    await (await _hb()).humanDelay(page, 500, 2000);
                    await logInfo('organicContent.specificReaction', {});
                    return;
                }
            }
        }

        // Fallback a un semplice Like / React Toggle
        await locator.click({ delay: randomInt(40, 100) });
        // NEW-12: Dwell time post-like (osserva animazione contatore)
        await (await _hb()).humanDelay(page, 500, 1800);
        await logInfo('organicContent.genericLike', {});
        return;
    }
}
