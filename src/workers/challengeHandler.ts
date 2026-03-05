/**
 * workers/challengeHandler.ts
 * ─────────────────────────────────────────────────────────────────
 * Tenta di risolvere automaticamente CAPTCHA/challenge usando
 * il VisionSolver (Ollama/LLaVA). Integrato nei worker come
 * step intermedio prima di lanciare ChallengeDetectedError.
 */

import { Page } from 'playwright';
import { VisionSolver } from '../captcha/solver';
import { humanDelay } from '../browser/humanBehavior';
import { logInfo, logWarn, logError } from '../telemetry/logger';

const MAX_ATTEMPTS = 2;

let cachedSolver: VisionSolver | null = null;

function getSolver(): VisionSolver {
    if (!cachedSolver) {
        cachedSolver = new VisionSolver();
    }
    return cachedSolver;
}

/**
 * Tenta di risolvere un challenge/CAPTCHA sulla pagina corrente.
 *
 * Flusso:
 *   1. Screenshot della pagina
 *   2. VisionSolver analizza il tipo di challenge
 *   3. Se è un CAPTCHA grid/image → trova coordinate e clicca
 *   4. Se non è risolvibile (testo, telefono, email verification) → false
 *   5. Verifica post-risoluzione: se la challenge è sparita → true
 *   6. Max 2 tentativi, poi restituisce false
 *
 * @returns true se il challenge è stato risolto, false altrimenti
 */
export async function attemptChallengeResolution(page: Page): Promise<boolean> {
    const solver = getSolver();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await logInfo('challenge.resolution_attempt', { attempt, maxAttempts: MAX_ATTEMPTS });

            const screenshotBuffer = await page.screenshot({ type: 'png' });
            const base64Image = screenshotBuffer.toString('base64');

            const analysis = await solver.analyzeImage(
                base64Image,
                'Analizza questa immagine. È una pagina web con un challenge di sicurezza. ' +
                    'Che tipo di challenge è? Rispondi con una sola parola tra: ' +
                    'CAPTCHA_IMAGE, CAPTCHA_GRID, TEXT_VERIFY, PHONE_VERIFY, EMAIL_VERIFY, BLOCKED, UNKNOWN',
            );

            const challengeType = analysis.trim().toUpperCase();
            await logInfo('challenge.type_detected', { attempt, challengeType });

            if (['TEXT_VERIFY', 'PHONE_VERIFY', 'EMAIL_VERIFY', 'BLOCKED'].some((t) => challengeType.includes(t))) {
                await logWarn('challenge.not_auto_resolvable', {
                    attempt,
                    challengeType,
                    reason: 'Questo tipo di challenge richiede intervento umano.',
                });
                return false;
            }

            if (challengeType.includes('CAPTCHA_IMAGE') || challengeType.includes('CAPTCHA_GRID')) {
                const coords = await solver.findObjectCoordinates(
                    base64Image,
                    'il riquadro o immagine corretta da selezionare per risolvere il CAPTCHA',
                );

                if (!coords) {
                    await logWarn('challenge.coords_not_found', { attempt });
                    continue;
                }

                await page.mouse.click(coords.x, coords.y);
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
                    await logInfo('challenge.resolved', { attempt });
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
