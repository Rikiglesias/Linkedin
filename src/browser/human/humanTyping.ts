/**
 * browser/human/humanTyping.ts
 * ─────────────────────────────────────────────────────────────────
 * Digitazione umana carattere-per-carattere: humanType (typo + correzione, cadenza
 * log-normale, word-flow multiplier, micro-pause distrazione). Estratto da
 * humanBehavior.ts (A13, split SRP). TIMING-CORE (keystroke dynamics) — la cadenza
 * inter-keystroke log-normale (logNormalDelayMs), il keystroke-floor assoluto (55/80ms,
 * zona-bot <50ms) e le probabilità di correzione/distrazione sono copiate VERBATIM:
 * un drift = firma key-injection rilevabile dall'ML keystroke di LinkedIn. NON riscrivere.
 */

import { Page } from 'playwright';
import { logNormalDelayMs } from '../../utils/random';
import { computeSessionTypoRate, determineNextKeystroke, getWordFlowMultiplier } from '../../ai/typoGenerator';
import { humanDelay } from './humanDelay';

/**
 * Digita il testo carattere per carattere con delay variabile.
 * Include il 3% di probabilità di errore di battitura + correzione (Backspace).
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
    const element = page.locator(selector).first();
    await element.click();
    await humanDelay(page, 200, 500);

    // Context-aware WPM: testi lunghi → ritmo più lento (affaticamento naturale).
    // Testi brevi (< 30 char): veloce. Medi (30-150): normale. Lunghi (> 150): lento.
    const lengthSlowFactor = text.length <= 30 ? 0.85 : text.length <= 150 ? 1.0 : text.length <= 400 ? 1.15 : 1.3;

    // Typing Flow State (6.3): pre-calcola le parole e i loro flow multiplier.
    // Parole comuni → 0.7x delay (flow state), parole rare → 1.4x delay (pensiero).
    const words = text.split(/(?<=\s)|(?=\s)/);
    let charIndex = 0;
    let currentWordIdx = 0;
    let currentWordMultiplier = words.length > 0 ? getWordFlowMultiplier(words[0]) : 1.0;

    for (let i = 0; i < text.length; i++) {
        const originalChar = text[i] ?? '';
        const { char: typedChar, isTypo } = determineNextKeystroke(originalChar, computeSessionTypoRate());

        // Aggiorna il word flow multiplier quando passiamo a una nuova parola
        charIndex++;
        if (currentWordIdx < words.length) {
            const currentWordLen = words[currentWordIdx].length;
            if (charIndex > currentWordLen && currentWordIdx < words.length - 1) {
                charIndex = 1;
                currentWordIdx++;
                currentWordMultiplier = getWordFlowMultiplier(words[currentWordIdx]);
            }
        }

        // AD-11: Implementazione Delay Bimodale + context-aware per lunghezza testo
        // + Typing Flow State (6.3): parole comuni più veloci, parole rare più lente
        const isSpaceOrPunctuation = /[\s.,!?-]/.test(typedChar);
        // B2 (2026-06-07): delay inter-keystroke LOG-NORMALE (right-skew = biometric umano reale)
        // invece di uniforme (Math.random()*range = istogramma piatto rilevabile dall'ML di LinkedIn).
        // Mediana ≈ media vecchia → throughput preservato; coda destra naturale. Fonti: keystroke
        // dynamics (flight time log-normale/ex-gaussian).
        const rawDelay = isSpaceOrPunctuation
            ? logNormalDelayMs(200, 0.42, 90, 650)
            : logNormalDelayMs(95, 0.42, 45, 320);
        // Floor ASSOLUTO post-moltiplicatore: lengthSlowFactor*currentWordMultiplier può scendere
        // a 0.595x e, applicato DOPO il clamp di logNormalDelayMs, bypassava il floor → keystroke
        // <28ms = oltre il record mondiale (firma key-injection). Il floor fisico umano va imposto
        // QUI, sull'effettivo.
        // W3/SOTA-2026 (keystroke dynamics): i keystroke <50ms (0.05s) sono la "zona bot" — la ricerca
        // mostra ~21% dei keystroke bot sotto 0.05s contro solo ~5.8% umani. Il floor char a 40ms
        // cadeva ancora in quella zona → alzato a 55ms (sopra 0.05s con margine). Spazio/punteggiatura
        // ≥80ms (flight time naturalmente più lungo, già ben sopra la soglia).
        const keystrokeFloorMs = isSpaceOrPunctuation ? 80 : 55;
        const delayBase = Math.max(keystrokeFloorMs, Math.round(rawDelay * lengthSlowFactor * currentWordMultiplier));

        await element.pressSequentially(typedChar, { delay: delayBase });

        if (isTypo) {
            // H17: Variare il pattern di correzione typo — un umano non corregge
            // sempre allo stesso modo. Pattern fisso = fingerprint rilevabile.
            const correctionStyle = Math.random();
            if (correctionStyle < 0.55) {
                // Stile 1 (55%): Backspace singolo + retype (classico)
                await page.waitForTimeout(280 + Math.random() * 420);
                await element.press('Backspace');
                await page.waitForTimeout(180 + Math.random() * 250);
                await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 80) + 60 });
            } else if (correctionStyle < 0.75) {
                // Stile 2 (20%): Cancella 2-3 char + riscrive (ha visto l'errore tardi)
                const charsBack = Math.min(i, 1 + Math.floor(Math.random() * 2));
                await page.waitForTimeout(350 + Math.random() * 500);
                for (let b = 0; b <= charsBack; b++) {
                    await element.press('Backspace');
                    await page.waitForTimeout(60 + Math.random() * 80);
                }
                await page.waitForTimeout(200 + Math.random() * 300);
                const retypeFrom = Math.max(0, i - charsBack);
                for (let r = retypeFrom; r <= i; r++) {
                    await element.pressSequentially(text[r] ?? '', { delay: Math.floor(Math.random() * 70) + 50 });
                }
            } else if (correctionStyle < 0.9) {
                // Stile 3 (15%): Ignora l'errore — un umano a volte non se ne accorge
                // (il typo resta nel testo, verrà comunque capito)
            } else {
                // Stile 4 (10%): Seleziona char sbagliato + sovrascrive (Shift+Left → type)
                await page.waitForTimeout(300 + Math.random() * 400);
                await page.keyboard.down('Shift');
                await element.press('ArrowLeft');
                await page.keyboard.up('Shift');
                await page.waitForTimeout(100 + Math.random() * 150);
                await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 80) + 60 });
            }
        }

        if (Math.random() < 0.04) {
            await humanDelay(page, 400, 1100);
        }

        // AB-4: Micro-pause "distrazione" — un umano si distrae durante la digitazione.
        // Ogni ~30 caratteri, 6% di probabilità di una micro-pausa riflessiva.
        if (i > 0 && i % 30 === 0 && Math.random() < 0.06) {
            const distractionType = Math.random();
            if (distractionType < 0.5) {
                // Tipo 1: Pausa lunga "rileggere il testo" (2-5s)
                await page.waitForTimeout(2000 + Math.random() * 3000);
            } else if (distractionType < 0.8) {
                // Tipo 2: Correzione riflessiva — cancella e riscrive ultimi 2-3 char
                const charsToRetype = Math.min(i, 2 + Math.floor(Math.random() * 2));
                for (let b = 0; b < charsToRetype; b++) {
                    await element.press('Backspace');
                    await page.waitForTimeout(80 + Math.random() * 120);
                }
                await page.waitForTimeout(400 + Math.random() * 600);
                const retypeStart = Math.max(0, i - charsToRetype + 1);
                for (let r = retypeStart; r <= i; r++) {
                    const ch = text[r] ?? '';
                    await element.pressSequentially(ch, { delay: Math.floor(Math.random() * 60) + 50 });
                }
            } else {
                // Tipo 3: Micro-pausa "controllo telefono" (1-3s, nessuna azione)
                await page.waitForTimeout(1000 + Math.random() * 2000);
            }
        }
    }
}
