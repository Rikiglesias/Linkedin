import { beforeEach, describe, expect, test, vi } from 'vitest';

// F-CB.10 / passo «canale comandi monotono-restrittivo».
//
// Il canale cloud `telegram_commands` (loopCommand.ts) e le due route REST di resume
// chiamavano un rilascio INCONDIZIONATO della pausa: un `/riprendi` mandato alla cieca
// spegneva anche una pausa aperta dall'incident manager (429, burst di selettori,
// challenge). Cioè: il remoto poteva disarmare un fail-safe anti-ban.
//
// Invariante che questi test difendono: il remoto può solo IMPORRE una restrizione,
// mai TOGLIERNE una imposta dal sistema. Il rilascio remoto è ammesso soltanto sulla
// pausa che l'utente stesso ha chiesto, e solo se non c'è nessuna protezione attiva.

const syncState = new Map<string, string>();

vi.mock('../db', () => ({
    getDatabase: async () => ({
        run: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('INSERT INTO sync_state')) {
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
        query: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('SELECT key FROM sync_state')) {
                const prefix = String(params[0]).replace(/%$/, '');
                return [...syncState.entries()]
                    .filter(([key, value]) => key.startsWith(prefix) && value === 'true')
                    .map(([key]) => ({ key }));
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        // `setAutomationPause`/`releaseAutomationPause` leggono e poi scrivono: nel codice
        // vero la coppia sta dentro BEGIN IMMEDIATE. Qui basta eseguire il callback.
        withTransaction: async <T>(cb: () => Promise<T>): Promise<T> => cb(),
    }),
}));

import {
    getAutomationPauseState,
    releaseAutomationPause,
    setAccountQuarantine,
    setAutomationPause,
    setRuntimeFlag,
} from '../core/repositories/system';

async function isPaused(): Promise<boolean> {
    return (await getAutomationPauseState()).paused;
}

describe('rilascio remoto della pausa — il cloud non disarma un fail-safe', () => {
    beforeEach(() => {
        syncState.clear();
    });

    test('pausa aperta dal SISTEMA: il canale cieco NON la rilascia', async () => {
        await setAutomationPause(60, 'HTTP_429_RATE_LIMIT', 'SYSTEM');

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });

        expect(esito.released).toBe(false);
        expect(esito.blockedBy).toBe('SYSTEM_PAUSE');
        expect(await isPaused()).toBe(true);
    });

    test('pausa chiesta dall’UTENTE: il canale cieco la rilascia', async () => {
        await setAutomationPause(30, 'TELEGRAM_COMMAND', 'USER');

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });

        expect(esito.released).toBe(true);
        expect(await isPaused()).toBe(false);
    });

    test('origine ASSENTE (pausa scritta da una versione precedente) → trattata come sistema', async () => {
        // Retro-compat fail-closed: una pausa già in corso all'aggiornamento non ha il flag
        // di origine. Il default deve proteggerla, non rilasciarla.
        await setRuntimeFlag('automation_paused', 'true');
        await setRuntimeFlag('automation_pause_reason', 'qualcosa_di_vecchio');
        await setRuntimeFlag('automation_paused_until', '');

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });

        expect(esito.released).toBe(false);
        expect(esito.blockedBy).toBe('SYSTEM_PAUSE');
        expect(await isPaused()).toBe(true);
    });

    test('default della firma: chi dimentica l’origine ottiene una pausa PROTETTA', async () => {
        // Un call-site futuro che chiama setAutomationPause(minuti, motivo) senza terzo
        // argomento non deve creare per sbaglio una pausa rilasciabile da remoto.
        await setAutomationPause(15, 'motivo_qualsiasi');

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });

        expect(esito.released).toBe(false);
        expect(await isPaused()).toBe(true);
    });

    test('quarantena attiva: nemmeno una pausa utente viene rilasciata da remoto', async () => {
        await setAutomationPause(30, 'TELEGRAM_COMMAND', 'USER');
        await setAccountQuarantine('default', true);

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });

        expect(esito.released).toBe(false);
        expect(esito.blockedBy).toBe('QUARANTINE');
        expect(await isPaused()).toBe(true);
    });

    test('challenge in attesa di revisione: rilascio remoto rifiutato', async () => {
        await setAutomationPause(30, 'TELEGRAM_COMMAND', 'USER');
        await setRuntimeFlag('challenge_review_pending', 'true');

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });

        expect(esito.released).toBe(false);
        expect(esito.blockedBy).toBe('CHALLENGE_PENDING');
        expect(await isPaused()).toBe(true);
    });

    test('operatore alla dashboard: senza conferma esplicita non spegne una pausa di sistema', async () => {
        await setAutomationPause(60, 'SELECTOR_FAILURE_BURST', 'SYSTEM');

        const esito = await releaseAutomationPause({ channel: 'OPERATOR' });

        expect(esito.released).toBe(false);
        expect(esito.blockedBy).toBe('SYSTEM_PAUSE');
        expect(await isPaused()).toBe(true);
    });

    test('operatore alla dashboard CON conferma esplicita: rilascia e resta tracciato', async () => {
        await setAutomationPause(60, 'SELECTOR_FAILURE_BURST', 'SYSTEM');

        const esito = await releaseAutomationPause({ channel: 'OPERATOR', force: true });

        expect(esito.released).toBe(true);
        expect(esito.forced).toBe(true);
        expect(await isPaused()).toBe(false);
    });

    test('il canale cieco non ha la conferma esplicita: force ignorato per costruzione', async () => {
        await setAutomationPause(60, 'HTTP_429_RATE_LIMIT', 'SYSTEM');

        // @ts-expect-error — `force` non deve essere accettato sul canale cieco: se un giorno
        // il tipo lo permettesse, questa riga smetterebbe di essere un errore e il test cade.
        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND', force: true });

        expect(esito.released).toBe(false);
        expect(await isPaused()).toBe(true);
    });
});

describe('una pausa non può indebolire quella già in corso', () => {
    beforeEach(() => {
        syncState.clear();
    });

    test('pausa utente CORTA sopra una pausa di sistema LUNGA: vince la più restrittiva', async () => {
        // Il bypass che la review anti-ban ha trovato nella prima versione del fix: se
        // `/pausa 5` sovrascrivesse la pausa da 60 minuti aperta dall'incident manager,
        // l'origine tornerebbe USER e `/riprendi` la rilascerebbe cinque minuti dopo.
        await setAutomationPause(60, 'HTTP_429_RATE_LIMIT', 'SYSTEM');
        const dopoSistema = await getAutomationPauseState();

        await setAutomationPause(5, 'TELEGRAM_COMMAND', 'USER');
        const dopoUtente = await getAutomationPauseState();

        expect(dopoUtente.pausedUntil).toBe(dopoSistema.pausedUntil);
        expect(dopoUtente.reason).toBe('HTTP_429_RATE_LIMIT');

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });
        expect(esito.released).toBe(false);
        expect(await isPaused()).toBe(true);
    });

    test('pausa utente PIÙ LUNGA di quella di sistema: la scadenza si estende, l’origine resta sistema', async () => {
        await setAutomationPause(10, 'HTTP_429_RATE_LIMIT', 'SYSTEM');
        await setAutomationPause(120, 'TELEGRAM_COMMAND', 'USER');

        const stato = await getAutomationPauseState();
        expect(stato.remainingSeconds).toBeGreaterThan(60 * 60);

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });
        expect(esito.released).toBe(false);
        expect(esito.blockedBy).toBe('SYSTEM_PAUSE');
    });

    test('pausa INDEFINITA di sistema: nessuna durata la può accorciare', async () => {
        await setAutomationPause(null, 'CHALLENGE_GATE', 'SYSTEM');
        await setAutomationPause(5, 'TELEGRAM_COMMAND', 'USER');

        const stato = await getAutomationPauseState();
        expect(stato.paused).toBe(true);
        expect(stato.pausedUntil).toBeNull();
    });

    test('due pause utente in fila: la seconda può accorciare la prima (nessun fail-safe in mezzo)', async () => {
        await setAutomationPause(120, 'TELEGRAM_COMMAND', 'USER');
        await setAutomationPause(5, 'TELEGRAM_COMMAND', 'USER');

        const stato = await getAutomationPauseState();
        expect(stato.remainingSeconds).toBeLessThanOrEqual(5 * 60);

        const esito = await releaseAutomationPause({ channel: 'REMOTE_BLIND' });
        expect(esito.released).toBe(true);
    });
});
