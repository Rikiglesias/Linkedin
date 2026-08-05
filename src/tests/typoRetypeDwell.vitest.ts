import { describe, it, expect, vi, afterEach } from 'vitest';
import { humanType } from '../browser/human/humanTyping';

/**
 * F-cd207f61 — buco di copertura, non un bug: `premiTasto` (il ciclo che ridigita dopo un typo) e'
 * raggiungibile SOLO dai rami di correzione, e l'unico test che guidava `humanType`
 * (`keystrokeDwellFlight.vitest.ts`) monta un mock con `isTypo: false` **sempre**. Risultato: quei
 * rami non venivano eseguiti da nessun test, e la falla dei moltiplicatori chiusa in `2357113`
 * poteva tornare senza che niente diventasse rosso.
 *
 * I mock di modulo in vitest sono per-FILE: per forzare il typo serve questo file separato, non un
 * caso in piu' nell'altro.
 *
 * Cosa blocca: i caratteri RIDIGITATI dopo una correzione devono avere lo stesso trattamento di
 * quelli normali — dwell nella finestra umana e flight esplicito dopo. Una cadenza diversa proprio
 * nei punti in cui l'utente "si corregge" e' una discontinuita' misurabile.
 */

let typoErogato = false;

vi.mock('../ai/typoGenerator', () => ({
    computeSessionTypoRate: () => 1,
    // Un solo typo per esecuzione: il primo carattere. Dopo, digitazione pulita — cosi' i valori
    // registrati restano leggibili e il test non dipende dal numero di correzioni.
    determineNextKeystroke: (char: string) => {
        if (!typoErogato) {
            typoErogato = true;
            return { char: 'x', isTypo: true };
        }
        return { char, isTypo: false };
    },
    getWordFlowMultiplier: () => 1,
}));

function pageFinta() {
    const dwellRegistrati: number[] = [];
    const atteseRegistrate: number[] = [];
    const tastiPremuti: string[] = [];
    const element = {
        click: vi.fn(async () => undefined),
        pressSequentially: vi.fn(async (_char: string, opts?: { delay?: number }) => {
            dwellRegistrati.push(opts?.delay ?? -1);
        }),
        press: vi.fn(async (key: string) => {
            tastiPremuti.push(key);
        }),
    };
    const page = {
        locator: () => ({ first: () => element }),
        waitForTimeout: vi.fn(async (ms: number) => {
            atteseRegistrate.push(ms);
        }),
        keyboard: { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) },
        mouse: { move: vi.fn(async () => undefined) },
    };
    return { page, element, dwellRegistrati, atteseRegistrate, tastiPremuti };
}

afterEach(() => {
    vi.restoreAllMocks();
    typoErogato = false;
});

describe('correzione dopo un typo: i caratteri ridigitati non sono di serie B', () => {
    it('il ramo di correzione viene ESEGUITO davvero (senza questo, il resto non prova nulla)', async () => {
        // 0.3 < 0.55 => stile 1: Backspace singolo + retype, il piu' semplice da asserire.
        vi.spyOn(Math, 'random').mockReturnValue(0.3);
        const { page, tastiPremuti } = pageFinta();

        await humanType(page as never, '#campo', 'abcde', { skipInitialClick: true });

        expect(tastiPremuti).toContain('Backspace');
    });

    it('ogni carattere, ridigitato o no, ha un dwell nella finestra umana', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.3);
        const { page, dwellRegistrati } = pageFinta();

        await humanType(page as never, '#campo', 'abcde', { skipInitialClick: true });

        // 5 caratteri + 1 ridigitato dopo il typo.
        expect(dwellRegistrati.length).toBe(6);
        for (const dwell of dwellRegistrati) {
            expect(dwell).toBeGreaterThanOrEqual(62);
            expect(dwell).toBeLessThanOrEqual(118);
        }
    });

    it('ROSSO DI CONTROLLO dei moltiplicatori: dopo il retype esiste un flight, non zero', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.3);
        const { page, dwellRegistrati, atteseRegistrate } = pageFinta();

        await humanType(page as never, '#campo', 'abcde', { skipInitialClick: true });

        // `premiTasto` fa pressSequentially + waitForTimeout: se qualcuno togliesse il flight dal
        // ramo di correzione (o passasse `humanKeystrokeDelayMs` senza moltiplicatori, la falla di
        // 2357113), il numero di attese scenderebbe sotto quello dei caratteri digitati.
        expect(atteseRegistrate.length).toBeGreaterThanOrEqual(dwellRegistrati.length);
        for (const attesa of atteseRegistrate) {
            expect(attesa).toBeGreaterThan(0);
        }
    });
});
