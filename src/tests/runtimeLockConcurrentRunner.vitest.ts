/**
 * runtimeLockConcurrentRunner.vitest.ts — C17(b)+(c) del contratto `bot-operativo`.
 *
 * (b) Con un lock VIVO il runner concorrente è rifiutato: `acquired:false`, holder = primo runner, metrica
 *     `acquire_contended`, nessun job accodato dal secondo (il loop lancia PRIMA di accodare).
 * (c) UN solo namespace per account: la chiave è sempre `workflow.runner:<accountId>` (`default` incluso), sia
 *     senza flag sia con `--account`. Prima `loopCommand.ts` usava `workflow.runner` senza flag e
 *     `workflow.runner:<override>` con `--account` → due runner sullo stesso account `default` potevano convivere.
 *     `health.ts` e la diagnostica osservano tutti i namespace `workflow.runner%`.
 * Prova sul DB di test REALE (copia condivisa fra i worker): chiavi uniche per run, righe pulite in coda.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { getRuntimeAccountProfiles } from '../accountManager';
import { getLocalDateString } from '../config';
import { listLockMetricsByDate } from '../core/repositories/lockMetrics';
import { acquireRuntimeLock, getRuntimeLock, releaseRuntimeLock } from '../core/repositories/system';
import {
    currentWorkflowRunnerLockKey,
    listWorkflowRunnerLocks,
    resolveWorkflowRunnerAccountId,
    WORKFLOW_RUNNER_LOCK_PREFIX,
    workflowRunnerLockKey,
} from '../core/workflowRunnerLock';
import { getDatabase } from '../db';

const TAG = `${process.pid}-${Date.now()}`;
const ACCOUNT = `__c17_conc_${TAG}__`;
const KEY = workflowRunnerLockKey(ACCOUNT);
const MIXED_OWNER = `runner-noflag-${TAG}`;

afterAll(async () => {
    const db = await getDatabase();
    await db.run('DELETE FROM runtime_locks WHERE lock_key = ?', [KEY]);
    await db.run('DELETE FROM lock_metrics WHERE lock_key = ?', [KEY]);
    // Il caso misto usa la chiave REALE dell'account runtime: si rilascia col proprio owner, mai con DELETE.
    await releaseRuntimeLock(currentWorkflowRunnerLockKey(), MIXED_OWNER);
});

function readSource(relative: string): string {
    return readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
}

describe('C17(b) — runner concorrente rifiutato', () => {
    it('lock vivo → il secondo runner ha acquired:false, holder = primo, metrica acquire_contended', async () => {
        const first = await acquireRuntimeLock(KEY, 'runner-A', 60, { test: 'c17-conc' });
        expect(first.acquired).toBe(true);

        const second = await acquireRuntimeLock(KEY, 'runner-B', 60, { test: 'c17-conc' });
        expect(second.acquired).toBe(false);
        expect(second.lock?.owner_id).toBe('runner-A');

        const stillA = await getRuntimeLock(KEY);
        expect(stillA?.owner_id).toBe('runner-A');

        const metrics = (await listLockMetricsByDate(getLocalDateString())).filter((m) => m.lockKey === KEY);
        expect(metrics.find((m) => m.metric === 'acquire_contended')?.value ?? 0).toBeGreaterThanOrEqual(1);
        expect(metrics.find((m) => m.metric === 'acquire_stale_takeover')).toBeUndefined();
    });

    it('health e diagnostica vedono il lock nel namespace per-account, e non lo vedono più dopo il rilascio', async () => {
        const active = await listWorkflowRunnerLocks({ activeOnly: true });
        expect(active.some((lock) => lock.lock_key === KEY && lock.owner_id === 'runner-A')).toBe(true);

        expect(await releaseRuntimeLock(KEY, 'runner-A')).toBe(true);
        const afterRelease = await listWorkflowRunnerLocks({ activeOnly: true });
        expect(afterRelease.some((lock) => lock.lock_key === KEY)).toBe(false);
    });
});

describe('C17(c) — un solo namespace per account', () => {
    it('la chiave è workflow.runner:<accountId>, `default` incluso, mai la chiave nuda', () => {
        expect(WORKFLOW_RUNNER_LOCK_PREFIX).toBe('workflow.runner');
        expect(workflowRunnerLockKey('default')).toBe('workflow.runner:default');
        expect(workflowRunnerLockKey('acc2')).toBe('workflow.runner:acc2');
    });

    it('senza flag la chiave è quella dell’account runtime; con --account <stesso id> è IDENTICA', () => {
        const runtimeId = resolveWorkflowRunnerAccountId(undefined);
        expect(runtimeId).toBe(getRuntimeAccountProfiles()[0]?.id ?? 'default');
        expect(currentWorkflowRunnerLockKey()).toBe(workflowRunnerLockKey(runtimeId));
        expect(currentWorkflowRunnerLockKey(runtimeId)).toBe(currentWorkflowRunnerLockKey());
        expect(currentWorkflowRunnerLockKey()).not.toBe('workflow.runner');
        // Un override diverso resta in un namespace diverso (multi-account).
        expect(currentWorkflowRunnerLockKey('altro-account')).toBe('workflow.runner:altro-account');
    });

    it('caso misto sul DB: runner senza flag + runner --account <stesso account> → il secondo acquired:false', async () => {
        const runtimeId = resolveWorkflowRunnerAccountId(undefined);
        const keyNoFlag = currentWorkflowRunnerLockKey();
        const keyWithFlag = currentWorkflowRunnerLockKey(runtimeId);
        expect(keyWithFlag).toBe(keyNoFlag);

        const noFlag = await acquireRuntimeLock(keyNoFlag, MIXED_OWNER, 60, { test: 'c17-mixed' });
        expect(noFlag.acquired).toBe(true);
        const withFlag = await acquireRuntimeLock(keyWithFlag, `runner-flag-${TAG}`, 60, { test: 'c17-mixed' });
        expect(withFlag.acquired).toBe(false);
        expect(withFlag.lock?.owner_id).toBe(MIXED_OWNER);

        const active = await listWorkflowRunnerLocks({ activeOnly: true });
        expect(active.some((lock) => lock.lock_key === keyNoFlag && lock.owner_id === MIXED_OWNER)).toBe(true);
    });

    it('sentinelle: nessun sito usa più la chiave globale nuda', () => {
        const loop = readSource('cli/commands/loopCommand.ts');
        expect(loop).not.toMatch(/_workflowRunnerLockKey\s*=\s*'workflow\.runner'/);
        expect(loop).not.toMatch(/`workflow\.runner:\$\{/);
        expect(loop).toContain('currentWorkflowRunnerLockKey');

        const health = readSource('api/routes/health.ts');
        expect(health).not.toContain("lock_key = 'workflow.runner'");
        expect(health).toContain('listWorkflowRunnerLocks');

        const admin = readSource('cli/commands/adminCommands.ts');
        expect(admin).not.toMatch(/const WORKFLOW_RUNNER_LOCK_KEY\s*=\s*'workflow\.runner'/);
        expect(admin).toContain('listWorkflowRunnerLocks');
    });
});
