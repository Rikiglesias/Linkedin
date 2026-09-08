/**
 * FIXTURE — non e' codice di produzione e non viene mai eseguita.
 *
 * Serve come CONTROLLO POSITIVO della sentinella `inputBlockAlwaysReleased.vitest.ts`: senza di
 * essa, se `ripresaNelFinally` ritornasse sempre `true` la sentinella resterebbe verde su tutto
 * (`violazioni` vuota per costruzione, `totalePause` calcolato prima del check) e nessun test se ne
 * accorgerebbe — la rete sembrerebbe intatta mentre non guarda piu' niente.
 *
 * Questo file sta sotto `src/tests/`, che `listTsFiles` esclude dalla scansione di produzione:
 * viene letto SOLO quando il test punta esplicitamente questa radice.
 *
 * Contiene tre casi con esito atteso noto:
 *   1. `pausaRilasciataBene`      -> nessuna violazione (finally ancorato alla pausa)
 *   2. `finallyNonAncorato`       -> violazione (il buco del finding F1: un try/finally piu' avanti
 *                                    nella funzione non sorveglia la pausa precedente)
 *   3. `pausaSenzaFinally`        -> violazione (nessun finally)
 */
import type { Page } from 'playwright';
import { pauseInputBlock, resumeInputBlock } from '../../../browser/humanBehavior';

export async function pausaRilasciataBene(page: Page): Promise<void> {
    await pauseInputBlock(page, 400);
    try {
        await page.mouse.move(10, 10);
    } finally {
        await resumeInputBlock(page);
    }
}

export async function finallyNonAncorato(page: Page): Promise<void> {
    await pauseInputBlock(page, 400);
    await page.mouse.move(10, 10);

    // Il finally sta qui sotto, ma NON e' il fratello della pausa: se il move sopra lancia, la
    // ripresa non viene mai eseguita e l'overlay resta sospeso.
    try {
        await page.mouse.move(20, 20);
    } finally {
        await resumeInputBlock(page);
    }
}

export async function pausaSenzaFinally(page: Page): Promise<void> {
    await pauseInputBlock(page, 400);
    await page.mouse.move(30, 30);
    await resumeInputBlock(page);
}
