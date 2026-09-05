/**
 * runtimeLockStaleTakeover.vitest.ts — C17(a) del contratto `bot-operativo`: takeover del lock STALE.
 *
 * Un runner morto lascia il suo lock nel DB con `expires_at` passato. Il runner successivo deve prenderlo
 * (`acquired:true`, metrica `acquire_stale_takeover`, `system.ts` UPDATE condizionale atomico) e il vecchio owner
 * non deve più poterlo rinnovare col heartbeat. Prova sul DB di test REALE (copia condivisa fra i worker): chiave
 * unica per run, righe pulite in coda.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { getLocalDateString } from '../config';
import { listLockMetricsByDate } from '../core/repositories/lockMetrics';
import { acquireRuntimeLock, getRuntimeLock, heartbeatRuntimeLock } from '../core/repositories/system';
import { workflowRunnerLockKey } from '../core/workflowRunnerLock';
import { getDatabase } from '../db';

const TAG = `${process.pid}-${Date.now()}`;
const ACCOUNT = `__c17_stale_${TAG}__`;
const KEY = workflowRunnerLockKey(ACCOUNT);

afterAll(async () => {
    const db = await getDatabase();
    await db.run('DELETE FROM runtime_locks WHERE lock_key = ?', [KEY]);
    await db.run('DELETE FROM lock_metrics WHERE lock_key = ?', [KEY]);
});

describe('C17(a) — takeover del lock workflow.runner stale', () => {
    it('la chiave è nel namespace per-account', () => {
        expect(KEY).toBe(`workflow.runner:${ACCOUNT}`);
    });

    it('lock scaduto → il nuovo runner lo prende (acquired:true, metrica acquire_stale_takeover)', async () => {
        const first = await acquireRuntimeLock(KEY, 'runner-A', 60, { test: 'c17-stale' });
        expect(first.acquired).toBe(true);
        expect(first.lock?.owner_id).toBe('runner-A');

        // Il runner A «muore»: nessun heartbeat, la scadenza passa.
        const db = await getDatabase();
        await db.run("UPDATE runtime_locks SET expires_at = DATETIME('now', '-5 seconds') WHERE lock_key = ?", [KEY]);
        const stale = await getRuntimeLock(KEY);
        expect(stale?.owner_id).toBe('runner-A');

        const second = await acquireRuntimeLock(KEY, 'runner-B', 60, { test: 'c17-stale' });
        expect(second.acquired).toBe(true);
        expect(second.lock?.owner_id).toBe('runner-B');

        const now = await getRuntimeLock(KEY);
        expect(now?.owner_id).toBe('runner-B');

        const metrics = (await listLockMetricsByDate(getLocalDateString())).filter((m) => m.lockKey === KEY);
        const takeover = metrics.find((m) => m.metric === 'acquire_stale_takeover');
        expect(takeover?.value ?? 0).toBeGreaterThanOrEqual(1);
        expect(metrics.find((m) => m.metric === 'acquire_contended')).toBeUndefined();
    });

    it('il vecchio owner non può più rinnovare il lock preso da un altro', async () => {
        const renewedByOld = await heartbeatRuntimeLock(KEY, 'runner-A', 60);
        expect(renewedByOld).toBe(false);
        const renewedByNew = await heartbeatRuntimeLock(KEY, 'runner-B', 60);
        expect(renewedByNew).toBe(true);
    });
});
