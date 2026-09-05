/**
 * workflowRunnerLock.ts — chiave e osservazione del lock `workflow.runner` (C17 del contratto `bot-operativo`).
 *
 * UN solo namespace per account: la chiave è SEMPRE `workflow.runner:<accountId>` (`default` incluso), sia quando il
 * loop parte senza flag sia con `--account <id>`. Prima `loopCommand.ts` usava `workflow.runner` senza flag e
 * `workflow.runner:<override>` con il flag → due runner sullo stesso account `default` potevano convivere (volume
 * doppio, azioni concorrenti = rischio ban). Chi osserva «c'è un runner vivo?» (health, diagnostica) guarda tutti i
 * namespace `workflow.runner%`, compresa l'eventuale chiave nuda lasciata da un daemon di una versione precedente.
 *
 * Residuo dichiarato: con multi-account acceso e senza `--account`, il runner «leader» lavora per tutti i profili ma
 * blocca solo il namespace del primo; un runner `--account <altro>` resta ammesso in parallelo (comportamento di oggi).
 */
import { getRuntimeAccountProfiles } from '../accountManager';
import { type RuntimeLockRecord } from './repositories.types';
import { listRuntimeLocksByPrefix } from './repositories/system';

export const WORKFLOW_RUNNER_LOCK_PREFIX = 'workflow.runner';
export const DEFAULT_WORKFLOW_RUNNER_ACCOUNT_ID = 'default';

/** Chiave del lock per un account: pura, senza leggere la config. */
export function workflowRunnerLockKey(accountId: string): string {
    return `${WORKFLOW_RUNNER_LOCK_PREFIX}:${accountId}`;
}

/** L'account su cui gira il runner: l'override CLI se c'è, altrimenti il primo profilo runtime (`default` a profilo unico). */
export function resolveWorkflowRunnerAccountId(accountOverride?: string | null): string {
    if (accountOverride) return accountOverride;
    return getRuntimeAccountProfiles()[0]?.id ?? DEFAULT_WORKFLOW_RUNNER_ACCOUNT_ID;
}

/** Chiave del lock per il runner corrente (senza flag e con `--account <stesso id>` è la STESSA). */
export function currentWorkflowRunnerLockKey(accountOverride?: string | null): string {
    return workflowRunnerLockKey(resolveWorkflowRunnerAccountId(accountOverride));
}

/** Tutti i lock dei runner, in ogni namespace (`workflow.runner%`), dal heartbeat più recente. */
export async function listWorkflowRunnerLocks(options: { activeOnly?: boolean } = {}): Promise<RuntimeLockRecord[]> {
    return listRuntimeLocksByPrefix(WORKFLOW_RUNNER_LOCK_PREFIX, options);
}
