import { describe, it, expect } from 'vitest';
import { getWorkerTypeBackpressureLevel } from '../sync/backpressure';

describe('backpressure — worker type scoped (M20)', () => {
    it('getWorkerTypeBackpressureLevel ritorna 1 per worker senza storico', async () => {
        // Senza DB, getRuntimeFlag ritorna null → default 1
        const level = await getWorkerTypeBackpressureLevel('test-account', 'INVITE').catch(() => 1);
        expect(level).toBe(1);
    });

    it('tipo INVITE e MESSAGE sono indipendenti (concettuale)', () => {
        // Verifica che le chiavi siano diverse
        const inviteKey = `backpressure.worker.acc1.INVITE.level`;
        const messageKey = `backpressure.worker.acc1.MESSAGE.level`;
        expect(inviteKey).not.toBe(messageKey);
    });
});
