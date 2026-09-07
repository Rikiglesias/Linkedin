/**
 * unquarantinePerAccount.vitest.ts — review pre-push del blocco A (goal `bot-operativo`).
 *
 * Il buco che chiude: da C27 la quarantena e' PER-ACCOUNT anche quando l'account si chiama `default`
 * (chiave `account_quarantine:default`), ma `bot.ps1 unquarantine` senza `--account` toccava solo il
 * flag globale legacy. L'operatore eseguiva esattamente il comando che i messaggi del bot gli
 * indicano e restava bloccato: la leva che deve sbloccare non sbloccava.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    quarantene: new Set<string>(),
    globale: { attiva: false },
    setQuarantine: vi.fn(),
    getQuarantineStatus: vi.fn(),
    clearPauseState: vi.fn(async () => undefined),
    recordSecurityAuditEvent: vi.fn(async () => undefined),
}));

vi.mock('../risk/incidentManager', () => ({
    setQuarantine: mocks.setQuarantine,
    resumeAutomation: vi.fn(async () => undefined),
}));

// Solo le tre funzioni che questo comando usa davvero vengono sostituite: il resto del modulo resta
// quello vero, cosi' il test non deve inseguire ogni export che adminCommands importa per altri usi.
vi.mock('../core/repositories', async (importaVero) => ({
    ...(await importaVero<Record<string, unknown>>()),
    getQuarantineStatus: mocks.getQuarantineStatus,
    clearPauseState: mocks.clearPauseState,
    recordSecurityAuditEvent: mocks.recordSecurityAuditEvent,
}));

import { runUnquarantineCommand } from '../cli/commands/adminCommands';

describe('unquarantine — la leva sblocca davvero', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.quarantene.clear();
        mocks.quarantene.add('default');
        mocks.globale.attiva = true;
        mocks.setQuarantine.mockImplementation(async (attiva: boolean, id?: string) => {
            if (id) {
                if (attiva) mocks.quarantene.add(id);
                else mocks.quarantene.delete(id);
            } else {
                mocks.globale.attiva = attiva;
            }
        });
        mocks.getQuarantineStatus.mockImplementation(async () => ({
            any: mocks.globale.attiva || mocks.quarantene.size > 0,
            global: mocks.globale.attiva,
            accounts: [...mocks.quarantene],
        }));
    });

    it('senza --account spegne il flag globale E le chiavi per-account attive', async () => {
        await runUnquarantineCommand([]);
        expect(mocks.globale.attiva).toBe(false);
        expect([...mocks.quarantene]).toEqual([]);
        // La riga che l'operatore legge non deve piu' dire «ancora attiva» dopo un comando riuscito.
        const residuo = await mocks.getQuarantineStatus();
        expect(residuo.any).toBe(false);
    });

    it('con --account resta mirato: sblocca quello e lascia gli altri', async () => {
        mocks.quarantene.add('acc-2');
        await runUnquarantineCommand(['--account', 'default']);
        expect([...mocks.quarantene]).toEqual(['acc-2']);
        expect(mocks.globale.attiva).toBe(true);
    });

    it('lascia sempre traccia nel security audit', async () => {
        await runUnquarantineCommand([]);
        expect(mocks.recordSecurityAuditEvent).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'unquarantine', actor: 'cli', result: 'ALLOW' }),
        );
    });
});
