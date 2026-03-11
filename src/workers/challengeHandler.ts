/**
 * workers/challengeHandler.ts
 * ─────────────────────────────────────────────────────────────────
 * Tenta di risolvere automaticamente CAPTCHA/challenge usando
 * il VisionProvider (GPT-5.4 primary → Ollama fallback).
 *
 * GPT-5.4 è enormemente superiore a LLaVA per risolvere captcha
 * visivi e challenge interattivi. Più challenge risolti al primo
 * tentativo = meno sessioni interrotte = meno pattern di
 * "login multipli ripetuti" visibili a LinkedIn.
 */

import { Page } from 'playwright';
import { createVisionProvider } from '../captcha/visionProviderFactory';
import type { VisionProvider } from '../captcha/visionProvider';
import { humanDelay } from '../browser/humanBehavior';
import { logInfo, logWarn, logError } from '../telemetry/logger';

const MAX_ATTEMPTS = 2;
const MAX_AUTO_CHALLENGE_RESOLUTIONS_PER_DAY = 3;
let challengeResolutionsToday = 0;

/**
 * Tenta di risolvere un challenge/CAPTCHA sulla pagina corrente.
 *
 * Flusso:
 *   1. Screenshot della pagina
 *   2. VisionProvider analizza il tipo di challenge (GPT-5.4 se disponibile)
 *   3. Se è un CAPTCHA grid/image → trova coordinate e clicca
 *   4. Se non è risolvibile (testo, telefono, email verification) → false
 *   5. Verifica post-risoluzione: se la challenge è sparita → true
 *   6. Max 2 tentativi, poi restituisce false
 *
 * @returns true se il challenge è stato risolto, false altrimenti
 */
export async function attemptChallengeResolution(page: Page): Promise<boolean> {
    // Cap giornaliero: troppi CAPTCHA risolti automaticamente in un giorno
    // sono più sospetti di non risolverli. Limita a 3/giorno (in-memory, reset al restart).
    if (challengeResolutionsToday >= MAX_AUTO_CHALLENGE_RESOLUTIONS_PER_DAY) {
        await logWarn('challenge.daily_cap_reached', {
            todayResolutions: challengeResolutionsToday,
            cap: MAX_AUTO_CHALLENGE_RESOLUTIONS_PER_DAY,
        });
        return false;
    }

    const provider: VisionProvider = createVisionProvider();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await logInfo('challenge.resolution_attempt', {
                attempt,
                maxAttempts: MAX_ATTEMPTS,
                provider: provider.name,
            });

            const screenshotBuffer = await page.screenshot({ type: 'png' });
            const base64Image = screenshotBuffer.toString('base64');

            const analysis = await provider.analyzeImage(
                base64Image,
                'Analizza questa immagine. È una pagina web con un challenge di sicurezza. ' +
                    'Che tipo di challenge è? Rispondi con una sola parola tra: ' +
                    'CAPTCHA_IMAGE, CAPTCHA_GRID, TEXT_VERIFY, PHONE_VERIFY, EMAIL_VERIFY, BLOCKED, UNKNOWN',
            );

            const challengeType = analysis.text.trim().toUpperCase();
            await logInfo('challenge.type_detected', { attempt, challengeType, provider: analysis.provider });

            if (['TEXT_VERIFY', 'PHONE_VERIFY', 'EMAIL_VERIFY', 'BLOCKED'].some((t) => challengeType.includes(t))) {
                await logWarn('challenge.not_auto_resolvable', {
                    attempt,
                    challengeType,
                    reason: 'Questo tipo di challenge richiede intervento umano.',
                });
                return false;
            }

            if (challengeType.includes('CAPTCHA_IMAGE') || challengeType.includes('CAPTCHA_GRID')) {
                const coords = await provider.findCoordinates(
                    base64Image,
                    'il riquadro o immagine corretta da selezionare per risolvere il CAPTCHA',
                );

                if (!coords) {
                    await logWarn('challenge.coords_not_found', { attempt });
                    continue;
                }

                const vp = page.viewportSize() ?? { width: 1280, height: 800 };
                const safeX = Math.max(0, Math.min(vp.width - 1, coords.x));
                const safeY = Math.max(0, Math.min(vp.height - 1, coords.y));
                await page.mouse.click(safeX, safeY);
                await humanDelay(page, 1500, 3000);

                const submitButton = page
                    .locator(
                        'button[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Verifica")',
                    )
                    .first();
                if ((await submitButton.count()) > 0) {
                    await submitButton.click();
                    await humanDelay(page, 2000, 4000);
                }

                const stillChallenge = await isStillOnChallengePage(page);
                if (!stillChallenge) {
                    challengeResolutionsToday += 1;
                    await logInfo('challenge.resolved', { attempt, provider: provider.name, dailyTotal: challengeResolutionsToday });
                    return true;
                }

                await logWarn('challenge.still_present_after_attempt', { attempt });
                continue;
            }

            if (challengeType.includes('UNKNOWN')) {
                await logWarn('challenge.unknown_type', { attempt });
                continue;
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            await logError('challenge.resolution_error', { attempt, error: msg });
        }
    }

    await logWarn('challenge.all_attempts_exhausted', { maxAttempts: MAX_ATTEMPTS });
    return false;
}

async function isStillOnChallengePage(page: Page): Promise<boolean> {
    const url = page.url().toLowerCase();
    if (['checkpoint', 'challenge', 'captcha', 'security-verification'].some((t) => url.includes(t))) {
        return true;
    }

    const pageText = (await page.textContent('body').catch(() => ''))?.toLowerCase() ?? '';
    return /temporarily blocked|temporaneamente bloccato|restricted your account|account limitato/.test(pageText);
}
