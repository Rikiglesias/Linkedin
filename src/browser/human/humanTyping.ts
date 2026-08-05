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

import { Locator, Page } from 'playwright';
import { logNormalDelayMs, logNormalDelayMsResampled } from '../../utils/random';
import {
    computeSessionTypoRate,
    determineNextKeystroke,
    getWordFlowMultiplier,
    semeAccount01,
} from '../../ai/typoGenerator';
import { humanDelay } from './humanDelay';

/**
 * Digita il testo carattere per carattere con delay variabile.
 * Include il 3% di probabilità di errore di battitura + correzione (Backspace).
 */
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
 * Preme UN tasto con i due tempi separati: dwell come `delay` di Playwright, poi il flight atteso a
 * parte. Usata nei rami di correzione (retype dopo un typo, riscrittura dopo una micro-pausa), dove
 * prima i caratteri partivano a raffica — dwell arbitrario e flight 0 — mentre il ciclo principale
 * aveva gia' la sua cadenza. Stessa classe di difetto, stesso rimedio: se si correggesse solo il
 * ciclo principale resterebbero manciate di keystroke a intervallo nullo dopo ogni correzione.
 */
async function premiTasto(
    page: Page,
    element: Locator,
    char: string,
    lengthSlowFactor = 1,
    wordMultiplier = 1,
): Promise<void> {
    await element.pressSequentially(char, { delay: humanKeystrokeDwellMs() });
    // I moltiplicatori vanno passati anche qui: senza, i caratteri di correzione avrebbero una
    // cadenza leggermente diversa dal resto del testo, cioe' una discontinuita' misurabile proprio
    // nei punti in cui l'utente "si corregge". E' il rilievo che il critico aveva mosso al ramo
    // vision (F-2c6d84fb) — da non ricreare qui.
    await page.waitForTimeout(humanKeystrokeDelayMs(char, lengthSlowFactor, wordMultiplier));
}

/**
 * Qualunque cosa sappia premere un tasto: `Locator` e `page.keyboard` hanno entrambi questa firma,
 * quindi l'helper vale sia dentro un campo di testo sia sulla tastiera della pagina.
 */
interface TastoPremibile {
    press(key: string, options?: { delay?: number }): Promise<void>;
}

/**
 * Preme un tasto NON-carattere (Backspace, Delete, Escape, Control+A, frecce) con un tempo di
 * pressione umano.
 *
 * 🔴 Perche' esiste: `premiTasto` qui sopra cura dwell e flight, ma **solo per i caratteri**. Tutti
 * i tasti speciali passavano da `press(key)` nudo, che in Playwright significa `down` e `up` senza
 * attesa in mezzo ⇒ hold time **0 ms**. Dopo che i caratteri normali sono stati portati a 62-118 ms
 * (`01e7e23`), il contrasto e' diventato piu' netto di prima del fix: nella stessa sequenza di tasti
 * convivono pressioni umane e pressioni istantanee, che nessun dito puo' produrre.
 *
 * Il flight successivo si chiede passando `page`: fra due tasti speciali consecutivi (es. `Control+A`
 * poi `Delete`) un intervallo ~0 e' improbabile quanto il dwell ~0.
 */
export async function premiTastoSpeciale(
    target: TastoPremibile,
    key: string,
    opzioni?: { page?: Page },
): Promise<void> {
    await target.press(key, { delay: humanKeystrokeDwellMs() });
    if (opzioni?.page) {
        await opzioni.page.waitForTimeout(humanKeystrokeDelayMs(key));
    }
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

/**
 * Scrive UN carattere sulla superficie di destinazione, tenendolo premuto `dwellMs`.
 *
 * E' un callback e non un'interfaccia con un metodo comune perche' le due superfici reali NON hanno
 * lo stesso metodo: un campo usa `pressSequentially`, la tastiera della pagina usa `type`. La
 * differenza non e' cosmetica — `keyboard.press(char)` su un carattere accentato solleva
 * `Unknown key` (verificato il 2026-08-04 su `a` accentata), quindi la scelta del metodo appartiene
 * al chiamante, che sa su cosa sta scrivendo.
 */
export type ScrittoreDiCarattere = (char: string, dwellMs: number) => Promise<void>;

/**
 * Digita un testo carattere per carattere con dwell e flight SEPARATI, ovunque non ci sia il ciclo
 * completo di `humanType` (typo, correzioni, distrazioni).
 *
 * 🔴 Perche' esiste: tre siti scrivevano con `.type(testo, { delay: 25 + random*20 })`. Quel `delay`
 * e' il tempo di PRESSIONE e Playwright lo applica IDENTICO a ogni carattere, quindi producevano
 * insieme le due cose peggiori: un dwell **costante** (una firma) e sotto la soglia dei 50ms (la
 * zona-bot che il resto del file evita), con flight ~0. Passare qui un `humanKeystrokeDwellMs()`
 * secco non basterebbe: darebbe di nuovo UNA costante, solo piu' alta. Serve estrarre il dwell a
 * ogni carattere e attendere il flight a parte — cioe' esattamente questo ciclo.
 *
 * I moltiplicatori NON sono opzionali: senza, questa superficie avrebbe una cadenza diversa da ogni
 * altra del bot (`humanType`), cioe' una discontinuita' misurabile fra i campi della stessa pagina.
 */
export async function digitaTestoUmano(
    page: Page,
    scriviCarattere: ScrittoreDiCarattere,
    text: string,
    /**
     * Gancio eseguito PRIMA di ogni carattere, con la cadenza corrente gia' calcolata. Esiste per il
     * ramo typo di `uiFallback`, che deve iniettare un errore + correzione **con gli stessi
     * moltiplicatori** del testo che lo circonda: senza riceverli, quel ramo ricalcolerebbe una
     * cadenza propria — cioe' una discontinuita' proprio nei punti in cui l'utente "si corregge"
     * (F-08b7a53c). Cosi' la curva resta definita in UN solo posto.
     */
    primaDiOgniCarattere?: (lengthSlowFactor: number, wordMultiplier: number) => Promise<void>,
): Promise<void> {
    const lengthSlowFactor = fattoreLunghezzaTesto(text);
    const words = text.split(/(?<=\s)|(?=\s)/);
    let charIndex = 0;
    let currentWordIdx = 0;
    let currentWordMultiplier = words.length > 0 ? getWordFlowMultiplier(words[0]) : 1.0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i] ?? '';

        // Avanzamento del word-flow: copiato da `humanType` perche' e' la stessa cadenza, non una
        // variante — parole comuni piu' veloci, parole rare piu' lente.
        charIndex++;
        if (currentWordIdx < words.length) {
            const currentWordLen = words[currentWordIdx].length;
            if (charIndex > currentWordLen && currentWordIdx < words.length - 1) {
                charIndex = 1;
                currentWordIdx++;
                currentWordMultiplier = getWordFlowMultiplier(words[currentWordIdx]);
            }
        }

        if (primaDiOgniCarattere) await primaDiOgniCarattere(lengthSlowFactor, currentWordMultiplier);

        await scriviCarattere(char, humanKeystrokeDwellMs());
        await page.waitForTimeout(humanKeystrokeDelayMs(char, lengthSlowFactor, currentWordMultiplier));
    }
}

export interface HumanTypeOptions {
    /**
     * Salta il click di messa a fuoco iniziale, per chi ha GIA' cliccato il campo in modo umano
     * (es. `typeWithFallback`, che usa `clickLocatorHumanLike` con dwell prima di digitare).
     * Senza questa opzione la delega produrrebbe un secondo click sullo stesso campo — un'azione in
     * piu' e un ordine diverso da quello di un utente reale.
     * Default `false`: i chiamanti esistenti non cambiano comportamento.
     */
    skipInitialClick?: boolean;
}

export async function humanType(
    page: Page,
    selector: string,
    text: string,
    options: HumanTypeOptions = {},
): Promise<void> {
    const element = page.locator(selector).first();
    if (!options.skipInitialClick) {
        await element.click();
        await humanDelay(page, 200, 500);
    }

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
        // Formula spostata in humanKeystrokeDelayMs (sopra) per poterla riusare dove non c'e' un
        // locator: valori e ordine delle operazioni identici, nessun ricalcolo.
        const delayBase = humanKeystrokeDelayMs(typedChar, lengthSlowFactor, currentWordMultiplier);

        // `delay` e' il tempo di PRESSIONE (Playwright attende fra down e up), quindi qui va il dwell.
        await element.pressSequentially(typedChar, { delay: humanKeystrokeDwellMs() });
        // ...e l'intervallo fra un tasto e il successivo va atteso a parte: e' il flight time, che
        // prima non esisteva (~0ms, dentro la zona-bot). Le pause di pensiero vivono qui, non nella
        // pressione: e' il motivo per cui spazi e punteggiatura pesano su questo valore e non sul dwell.
        await page.waitForTimeout(delayBase);

        if (isTypo) {
            // H17: Variare il pattern di correzione typo — un umano non corregge
            // sempre allo stesso modo. Pattern fisso = fingerprint rilevabile.
            const correctionStyle = Math.random();
            if (correctionStyle < 0.55) {
                // Stile 1 (55%): Backspace singolo + retype (classico)
                await page.waitForTimeout(280 + Math.random() * 420);
                await premiTastoSpeciale(element, 'Backspace');
                await page.waitForTimeout(180 + Math.random() * 250);
                await premiTasto(page, element, originalChar, lengthSlowFactor, currentWordMultiplier);
            } else if (correctionStyle < 0.75) {
                // Stile 2 (20%): Cancella 2-3 char + riscrive (ha visto l'errore tardi)
                const charsBack = Math.min(i, 1 + Math.floor(Math.random() * 2));
                await page.waitForTimeout(350 + Math.random() * 500);
                for (let b = 0; b <= charsBack; b++) {
                    await premiTastoSpeciale(element, 'Backspace');
                    await page.waitForTimeout(60 + Math.random() * 80);
                }
                await page.waitForTimeout(200 + Math.random() * 300);
                const retypeFrom = Math.max(0, i - charsBack);
                for (let r = retypeFrom; r <= i; r++) {
                    await premiTasto(page, element, text[r] ?? '', lengthSlowFactor, currentWordMultiplier);
                }
            } else if (correctionStyle < 0.9) {
                // Stile 3 (15%): Ignora l'errore — un umano a volte non se ne accorge
                // (il typo resta nel testo, verrà comunque capito)
            } else {
                // Stile 4 (10%): Seleziona char sbagliato + sovrascrive (Shift+Left → type)
                await page.waitForTimeout(300 + Math.random() * 400);
                await page.keyboard.down('Shift');
                await premiTastoSpeciale(element, 'ArrowLeft');
                await page.keyboard.up('Shift');
                await page.waitForTimeout(100 + Math.random() * 150);
                await premiTasto(page, element, originalChar, lengthSlowFactor, currentWordMultiplier);
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
                    await premiTastoSpeciale(element, 'Backspace');
                    await page.waitForTimeout(80 + Math.random() * 120);
                }
                await page.waitForTimeout(400 + Math.random() * 600);
                const retypeStart = Math.max(0, i - charsToRetype + 1);
                for (let r = retypeStart; r <= i; r++) {
                    const ch = text[r] ?? '';
                    await premiTasto(page, element, ch, lengthSlowFactor, currentWordMultiplier);
                }
            } else {
                // Tipo 3: Micro-pausa "controllo telefono" (1-3s, nessuna azione)
                await page.waitForTimeout(1000 + Math.random() * 2000);
            }
        }
    }
}
