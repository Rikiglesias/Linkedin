/**
 * browser/human/keystrokeTiming.ts
 * ─────────────────────────────────────────────────────────────────
 * LA CURVA di battitura: dwell (quanto un tasto resta premuto), flight (intervallo fra due tasti)
 * e il rallentamento per testi lunghi. Nient'altro — qui non si tocca il DOM e non si preme niente.
 *
 * Estratto da `humanTyping.ts` (2026-08-05) quando quel file ha superato le 300 righe. Lo split
 * segue la linea naturale del modulo, non un taglio a meta': da una parte le FORMULE (pure, senza
 * `Locator` ne' `Page`), dall'altra i CICLI che le usano per scrivere su una superficie. Il beneficio
 * concreto e' che chi deve solo conoscere la cadenza — i test, il ramo typo di `uiFallback` — non
 * tira dentro l'intero motore di digitazione.
 *
 * TIMING-CORE, come il file d'origine: le costanti e le formule sono state SPOSTATE VERBATIM, non
 * riscritte. Un drift numerico qui e' una firma key-injection rilevabile dall'ML keystroke di
 * LinkedIn. NON riscrivere: se serve un valore diverso, va cambiato con una misura, non a occhio.
 */

import { logNormalDelayMs, logNormalDelayMsResampled } from '../../utils/random';
import { semeAccount01 } from '../../ai/typoGenerator';

/**
 * Valore passato come `delay` a Playwright per un carattere. ESTRATTA da `humanType`, non riscritta:
 * stessi parametri, stessa formula, stesso ordine — serve a riusarla dove si digita senza un locator
 * (ramo VisionSolver di `typeWithFallback`, che prima aveva una copia peggiore, uniforme e con floor
 * 40ms).
 *
 * Questo valore e' il FLIGHT TIME: l'intervallo fra il rilascio di un tasto e la pressione del
 * successivo. Va atteso ESPLICITAMENTE dal chiamante — NON passato come `delay` a Playwright.
 * Motivo, verificato nella libreria installata (`playwright-core/lib/server/input.js`, Keyboard.press):
 * la sequenza e' `down` -> `wait(options.delay)` -> `up`, quindi `delay` e' il tempo di PRESSIONE
 * (dwell). Passandogli questa distribuzione si otteneva un dwell fino a 650ms su uno spazio — non
 * umano — e un flight reale di ~0ms, cioe' dentro la zona-bot (<50ms) che le costanti qui sotto
 * dicevano di evitare: la difesa descritta non era quella ottenuta. Difetto trovato dal critico
 * avversariale il 2026-08-04, corretto separando i due tempi (vedi `humanKeystrokeDwellMs`).
 *
 * Le costanti sono TIMING-CORE e NON sono state riscritte: distribuzione log-normale (right-skew)
 * invece che uniforme, e floor ASSOLUTO applicato DOPO i moltiplicatori — 55ms per i caratteri, 80ms
 * per spazi e punteggiatura. E' cambiato solo il RUOLO: ora sono davvero l'intervallo fra i tasti.
 *
 * @param lengthSlowFactor rallentamento per testi lunghi (1 = neutro)
 * @param wordMultiplier   flow state della parola corrente (1 = neutro)
 */
export function humanKeystrokeDelayMs(char: string, lengthSlowFactor = 1, wordMultiplier = 1): number {
    const isSpaceOrPunctuation = /[\s.,!?-]/.test(char);
    const rawDelay = isSpaceOrPunctuation ? logNormalDelayMs(200, 0.42, 90, 650) : logNormalDelayMs(95, 0.42, 45, 320);
    const keystrokeFloorMs = isSpaceOrPunctuation ? 80 : 55;
    return Math.max(keystrokeFloorMs, Math.round(rawDelay * lengthSlowFactor * wordMultiplier));
}

/**
 * DWELL: per quanto il tasto resta premuto — il valore da passare come `delay` a Playwright, che lo
 * attende fra `down` e `up`.
 *
 * Separato dal flight time perche' sono due grandezze fisiche diverse: la pressione dipende dal dito,
 * l'intervallo fra i tasti dipende anche dal pensiero. Prima erano lo stesso numero, e il risultato
 * era un tasto tenuto premuto fino a 650ms con l'intervallo successivo a ~0.
 *
 * Perche' log-normale e non un uniforme 70-110: un intervallo uniforme produce un istogramma piatto,
 * che e' a sua volta una firma (le analisi di keystroke dynamics classificano i bot anche per
 * l'entropia dei tempi). Stessa forma right-skew usata per il resto del timing del progetto.
 * NB: il valore centrale (~85ms) e' un ordine di grandezza plausibile, NON una media empirica
 * triangolata — la letteratura consultata definisce dwell e flight ma non pubblica medie di
 * riferimento. Cio' che e' certo, ed e' il motivo del fix, e' che 650ms di pressione e 0ms di
 * intervallo non sono umani.
 */
export function humanKeystrokeDwellMs(): number {
    const { medianaMs, minMs, maxMs } = finestraDwellDellAccount();
    return logNormalDelayMsResampled(medianaMs, DWELL_SIGMA, minMs, maxMs);
}

const DWELL_SIGMA = 0.22;
/** Mediana di riferimento, prima della personalizzazione per account. */
const DWELL_MEDIANA_BASE = 85;
/** Rapporti della finestra rispetto alla mediana: identici agli originali 62/85 e 118/85. */
const DWELL_MIN_RATIO = 62 / DWELL_MEDIANA_BASE;
const DWELL_MAX_RATIO = 118 / DWELL_MEDIANA_BASE;
/** Floor assoluto: sotto i 50ms si entra nella zona-bot, e nessun seme puo' portarci li'. */
const DWELL_FLOOR_MS = 55;

/**
 * Finestra di dwell PROPRIA di questo account: mediana spostata dal seme, bordi in proporzione.
 *
 * 🔴 Perche': centro e bordi erano hard-coded uguali su OGNI account, mentre il vicino
 * `computeSessionTypoRate` e' seedato su `ACCOUNT_ID` proprio per non lasciare un fingerprint. Un
 * hold-time identico su tutti gli account e' un **correlatore cross-account**: lega fra loro profili
 * che dovrebbero sembrare persone diverse — piu' grave di una firma su un account solo, perche'
 * trasforma N account in uno.
 *
 * La mediana si muove del ±12% (75-95 ms): abbastanza da distinguere due persone, non tanto da
 * uscire dai tempi di battitura plausibili. I bordi seguono la mediana con gli STESSI rapporti
 * originali, quindi la forma della distribuzione non cambia — cambia dove e' centrata.
 */
export function finestraDwellDellAccount(): { medianaMs: number; minMs: number; maxMs: number } {
    const mediana = DWELL_MEDIANA_BASE * (0.88 + semeAccount01() * 0.24);
    return {
        medianaMs: mediana,
        minMs: Math.max(DWELL_FLOOR_MS, mediana * DWELL_MIN_RATIO),
        maxMs: mediana * DWELL_MAX_RATIO,
    };
}

/**
 * Rallentamento per testi lunghi (affaticamento naturale). ESTRATTA da `humanType`, non riscritta:
 * stessi scaglioni, stessi valori. Esiste perche' ora la stessa cadenza serve anche fuori da
 * `humanType` (`digitaTestoUmano`, ramo typo di `uiFallback`) e due copie della curva divergerebbero
 * al primo ritocco — cioe' produrrebbero superfici con ritmi diversi, che e' la firma da evitare.
 */
export function fattoreLunghezzaTesto(text: string): number {
    return text.length <= 30 ? 0.85 : text.length <= 150 ? 1.0 : text.length <= 400 ? 1.15 : 1.3;
}
