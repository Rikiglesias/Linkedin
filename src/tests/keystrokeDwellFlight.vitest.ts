import { describe, it, expect, vi, afterEach } from 'vitest';
import { humanType } from '../browser/human/humanTyping';

/**
 * Il valore passato come `delay` a Playwright NON e' l'intervallo fra un tasto e il successivo.
 * Verificato nella libreria installata (`playwright-core/lib/server/input.js`, Keyboard.press):
 * `down(key)` -> `wait(options.delay)` -> `up(key)`. Poiche' qui si digita UN carattere per
 * chiamata, quel valore e' il DWELL (quanto il tasto resta premuto) e il FLIGHT TIME fra i tasti
 * resta il solo round-trip del protocollo, cioe' ~0ms: esattamente la "zona bot" (<50ms) che le
 * costanti 55/80 dicevano di evitare. In piu' un dwell fino a 650ms su uno spazio non e' umano.
 *
 * Questi test bloccano il CONTRATTO, non i numeri della distribuzione (quelli restano in
 * `typingDelegation.vitest.ts`, e `humanKeystrokeDelayMs` non e' stata riscritta):
 *  - dopo ogni carattere esiste un'attesa ESPLICITA (il flight vero);
 *  - il `delay` passato a Playwright e' un dwell plausibile, non la distribuzione delle pause;
 *  - il dwell VARIA (un hold time a varianza zero e' esso stesso una firma rilevabile).
 */

vi.mock('../ai/typoGenerator', () => ({
    computeSessionTypoRate: () => 0,
    determineNextKeystroke: (char: string) => ({ char, isTypo: false }),
    getWordFlowMultiplier: () => 1,
}));

/** Page finta che REGISTRA i valori, non solo il fatto che la chiamata sia avvenuta. */
function pageFinta() {
    const dwellRegistrati: number[] = [];
    const atteseRegistrate: number[] = [];
    const element = {
        click: vi.fn(async () => undefined),
        pressSequentially: vi.fn(async (_char: string, opts?: { delay?: number }) => {
            dwellRegistrati.push(opts?.delay ?? -1);
        }),
        press: vi.fn(async () => undefined),
    };
    const page = {
        locator: () => ({ first: () => element }),
        waitForTimeout: vi.fn(async (ms: number) => {
            atteseRegistrate.push(ms);
        }),
        keyboard: { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) },
        mouse: { move: vi.fn(async () => undefined) },
    };
    return { page, element, dwellRegistrati, atteseRegistrate };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('digitazione: il tempo sta dove dice di stare (dwell vs flight)', () => {
    const TESTO = 'ciao come stai';

    it('fra un tasto e il successivo esiste un attesa esplicita, non zero', async () => {
        // Math.random fisso a 0.5: niente typo (0.5 > 0.03), niente pausa distrazione (0.5 > 0.06),
        // niente micro-pausa del 4% (0.5 > 0.04). Cosi' ogni attesa registrata e' SOLO il flight.
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const { page, atteseRegistrate } = pageFinta();

        await humanType(page as never, '#campo', TESTO, { skipInitialClick: true });

        // Una per carattere (l'ultima e' innocua), quindi almeno N-1.
        expect(atteseRegistrate.length).toBeGreaterThanOrEqual(TESTO.length - 1);
        // Nessun flight nella zona-bot: il floor della distribuzione e' 55ms per le lettere.
        for (const attesa of atteseRegistrate) {
            expect(attesa).toBeGreaterThanOrEqual(55);
        }
    });

    it('il dwell passato a Playwright e un tempo di pressione plausibile, non la pausa di pensiero', async () => {
        const { page, dwellRegistrati } = pageFinta();

        await humanType(page as never, '#campo', TESTO, { skipInitialClick: true });

        expect(dwellRegistrati.length).toBe(TESTO.length);
        for (const dwell of dwellRegistrati) {
            // Un tasto premuto per mezzo secondo non e' una battitura: era possibile fino a 650ms.
            expect(dwell).toBeGreaterThanOrEqual(60);
            expect(dwell).toBeLessThanOrEqual(120);
        }
    });

    it('il dwell varia: un hold time costante e esso stesso una firma', async () => {
        const { page, dwellRegistrati } = pageFinta();

        await humanType(page as never, '#campo', 'aaaaaaaaaaaaaaaaaaaa', { skipInitialClick: true });

        const distinti = new Set(dwellRegistrati);
        expect(distinti.size).toBeGreaterThan(3);
    });

    it('lo spazio non e piu premuto piu a lungo di una lettera: la pausa sta nel flight', async () => {
        // La differenza spazio/lettera deve vivere nell'intervallo FRA i tasti (dove un umano pensa),
        // non nella pressione (dove non c'e' motivo fisico perche' lo spazio duri 3 volte tanto).
        const { page, dwellRegistrati } = pageFinta();

        await humanType(page as never, '#campo', 'a a a a a a a a', { skipInitialClick: true });

        const max = Math.max(...dwellRegistrati);
        expect(max).toBeLessThanOrEqual(120);
    });
});
