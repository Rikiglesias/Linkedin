import { beforeEach, describe, expect, test, vi } from 'vitest';

// La monotonia della pausa deve reggere anche a due scritture CONCORRENTI.
//
// `setAutomationPause` e' diventata read-modify-write per poter tenere la pausa piu'
// restrittiva fra quella in corso e quella nuova. Ma CLI, API e loop sono processi distinti
// sullo stesso DB: se il comando `/pausa 5` legge lo stato PRIMA che l'incident manager
// abbia scritto la sua pausa da 60 minuti, non la vede, e la sovrascrive con una pausa
// utente da 5 minuti - che il canale remoto puo' poi rilasciare. Il buco che il fix chiude
// si riaprirebbe sotto concorrenza.
//
// `setRuntimeFlag` e' atomico sulla singola chiave (INSERT ... ON CONFLICT), ma qui le
// chiavi sono quattro e c'e' una lettura in mezzo: serve la transazione.

const syncState = new Map<string, string>();
/** Quando true, la scrittura della pausa UTENTE viene rallentata: e' cosi' che l'altro
 *  processo riesce a infilare la sua pausa di sistema FRA la lettura e la scrittura. */
let ritardaScritturaUtente = false;

const attesa = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

let transazioneInCorso: Promise<unknown> = Promise.resolve();

vi.mock('../db', () => ({
    getDatabase: async () => ({
        run: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('INSERT INTO sync_state')) {
                if (ritardaScritturaUtente && String(params[1]) === 'TELEGRAM_COMMAND') {
                    ritardaScritturaUtente = false;
                    await attesa();
                }
                syncState.set(String(params[0]), String(params[1]));
                return { changes: 1 };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        get: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('SELECT value FROM sync_state')) {
                const value = syncState.get(String(params[0]));
                return value === undefined ? undefined : { value };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        query: async () => [],
        // Il fake serializza come fa `BEGIN IMMEDIATE` su SQLite: una transazione alla volta.
        withTransaction: async <T>(cb: (tx: { isPostgres: boolean }) => Promise<T>): Promise<T> => {
            const precedente = transazioneInCorso;
            let sblocca: () => void = () => {};
            transazioneInCorso = new Promise<void>((r) => {
                sblocca = r;
            });
            await precedente;
            try {
                return await cb({ isPostgres: false });
            } finally {
                sblocca();
            }
        },
    }),
}));

import { getAutomationPauseState, setAutomationPause } from '../core/repositories/system';

describe('due pause concorrenti non si annullano a vicenda', () => {
    beforeEach(() => {
        syncState.clear();
        ritardaScritturaUtente = false;
        transazioneInCorso = Promise.resolve();
    });

    test('la pausa di sistema sopravvive a un comando utente che arriva nello stesso istante', async () => {
        ritardaScritturaUtente = true;

        await Promise.all([
            setAutomationPause(60, 'HTTP_429_RATE_LIMIT', 'SYSTEM'),
            setAutomationPause(5, 'TELEGRAM_COMMAND', 'USER'),
        ]);

        const stato = await getAutomationPauseState();
        expect(stato.paused).toBe(true);
        // Se la pausa utente avesse vinto la corsa, ne resterebbero ~5 minuti.
        expect(stato.remainingSeconds ?? 0).toBeGreaterThan(30 * 60);
        expect(stato.reason).toBe('HTTP_429_RATE_LIMIT');
    });

    test('ordine inverso: il comando utente arriva per primo e la pausa di sistema lo assorbe', async () => {
        ritardaScritturaUtente = true;

        await Promise.all([
            setAutomationPause(5, 'TELEGRAM_COMMAND', 'USER'),
            setAutomationPause(60, 'HTTP_429_RATE_LIMIT', 'SYSTEM'),
        ]);

        const stato = await getAutomationPauseState();
        expect(stato.remainingSeconds ?? 0).toBeGreaterThan(30 * 60);
    });
});
