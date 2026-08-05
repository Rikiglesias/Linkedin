import { describe, expect, it } from 'vitest';
import { finestraDwellDellAccount, premiTastoSpeciale } from '../browser/human/humanTyping';

/**
 * F-4a6e88d1: i tasti NON-carattere passavano da `press(key)` nudo ⇒ in Playwright `down` e `up`
 * senza attesa in mezzo = hold time **0 ms**. Dopo che i caratteri normali sono stati portati a
 * 62-118 ms (`01e7e23`), il contrasto e' diventato piu' netto di PRIMA di quel fix: nella stessa
 * sequenza convivevano pressioni umane e pressioni istantanee.
 *
 * Il caso che conta e' `messageWorker:396-397` (`Control+A` + `Delete` sulla textbox del messaggio,
 * subito prima del typing umanizzato sulla stessa superficie).
 */

function targetFinto() {
    const delays: (number | undefined)[] = [];
    const tasti: string[] = [];
    return {
        delays,
        tasti,
        press: async (key: string, options?: { delay?: number }) => {
            tasti.push(key);
            delays.push(options?.delay);
        },
    };
}

function pageFinta() {
    const attese: number[] = [];
    return {
        attese,
        waitForTimeout: async (ms: number) => {
            attese.push(ms);
        },
    };
}

describe('premiTastoSpeciale — un tasto speciale si preme come lo premerebbe un dito', () => {
    it('ROSSO DI CONTROLLO: `press(key)` nudo non passa alcun delay ⇒ hold 0 ms', async () => {
        const target = targetFinto();
        await target.press('Control+A'); // com'era prima
        expect(target.delays[0]).toBeUndefined();
    });

    it("passa un dwell nella finestra umana dell'account, diverso ogni volta", async () => {
        const target = targetFinto();
        for (let i = 0; i < 300; i++) {
            await premiTastoSpeciale(target, 'Backspace');
        }

        // La finestra NON e' piu' fissa a 62-118: dalla Fase 3 la mediana e' seedata sull'account
        // (F-6ce4907b), quindi si verifica contro la finestra REALE invece che contro due costanti
        // — che erano proprio il correlatore cross-account da eliminare.
        const finestra = finestraDwellDellAccount();
        const valori = target.delays as number[];
        expect(valori).toHaveLength(300);
        for (const v of valori) {
            expect(v).toBeGreaterThanOrEqual(Math.floor(finestra.minMs));
            expect(v).toBeLessThanOrEqual(Math.ceil(finestra.maxMs));
        }
        // Un valore costante sarebbe una firma quanto lo zero: serve dispersione reale.
        expect(new Set(valori).size).toBeGreaterThan(20);
    });

    it('con `page` attende anche il flight: fra due tasti l\'intervallo non e\' ~0', async () => {
        const target = targetFinto();
        const page = pageFinta();

        await premiTastoSpeciale(target, 'Control+A', { page: page as never });
        await premiTastoSpeciale(target, 'Delete', { page: page as never });

        expect(target.tasti).toEqual(['Control+A', 'Delete']);
        expect(page.attese).toHaveLength(2);
        for (const attesa of page.attese) {
            expect(attesa).toBeGreaterThan(0);
        }
    });

    it('senza `page` preme e basta: il flight lo decide il chiamante', async () => {
        const target = targetFinto();
        const page = pageFinta();

        await premiTastoSpeciale(target, 'Escape');

        expect(target.delays[0]).toBeGreaterThanOrEqual(62);
        expect(page.attese).toHaveLength(0);
    });
});
