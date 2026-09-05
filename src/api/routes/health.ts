import { Router } from 'express';
import { getDatabase } from '../../db';
import { config } from '../../config';
import { getAutomationPauseState, countPendingOutboxEvents } from '../../core/repositories';
import { checkCloudConnectivity } from '../../cloud/supabaseDataClient';
import { listWorkflowRunnerLocks } from '../../core/workflowRunnerLock';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

healthRouter.get('/deep', async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    let allOk = true;

    // 1. Connettività DB
    try {
        const db = await getDatabase();
        await db.get<{ v: number }>('SELECT 1 as v');
        checks.database = { ok: true };
    } catch (err: unknown) {
        checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        allOk = false;
    }

    // 2. Stato pausa/quarantine
    try {
        const pause = await getAutomationPauseState();
        checks.automation = {
            ok: !pause.paused,
            detail: pause.paused ? `Paused: ${pause.reason ?? 'unknown'}` : 'running',
        };
    } catch {
        checks.automation = { ok: false, detail: 'Unable to read pause state' };
        allOk = false;
    }

    // 3. Outbox backlog
    try {
        const pendingOutbox = await countPendingOutboxEvents();
        const threshold = config.outboxAlertBacklog ?? 1000;
        checks.outbox = {
            ok: pendingOutbox < threshold,
            detail: `${pendingOutbox} pending (threshold: ${threshold})`,
        };
        if (pendingOutbox >= threshold) allOk = false;
    } catch {
        checks.outbox = { ok: false, detail: 'Unable to read outbox' };
        allOk = false;
    }

    // 4. Queue depth
    try {
        const db = await getDatabase();
        const row = await db.get<{ total: number }>("SELECT COUNT(*) as total FROM jobs WHERE status = 'QUEUED'");
        const queueDepth = row ? Number(row.total) : 0;
        checks.queue = { ok: true, detail: `${queueDepth} queued jobs` };
    } catch {
        checks.queue = { ok: false, detail: 'Unable to read job queue' };
        allOk = false;
    }

    // 5. Daemon liveness (runtime_locks) — C17: un namespace per account, si osservano tutti (`workflow.runner%`).
    try {
        const [lock] = await listWorkflowRunnerLocks({ activeOnly: true });
        checks.daemon = {
            ok: !!lock,
            detail: lock
                ? `alive: owner=${lock.owner_id} heartbeat=${lock.heartbeat_at}`
                : 'no active lock — daemon not running or crashed',
        };
        if (!lock) allOk = false;
    } catch {
        checks.daemon = { ok: false, detail: 'Unable to read runtime_locks' };
        allOk = false;
    }

    // 6. Zombie automation_commands (RUNNING > 10 min)
    try {
        const db = await getDatabase();
        const row = await db.get<{ total: number }>(
            `SELECT COUNT(*) as total FROM automation_commands
             WHERE status = 'RUNNING'
               AND started_at <= DATETIME('now', '-10 minutes')`,
        );
        const zombies = row ? Number(row.total) : 0;
        checks.automationZombies = {
            ok: zombies === 0,
            detail: zombies === 0 ? 'no zombie commands' : `${zombies} RUNNING for >10min`,
        };
        if (zombies > 0) allOk = false;
    } catch {
        checks.automationZombies = { ok: false, detail: 'Unable to read automation_commands' };
        allOk = false;
    }

    // 7. Raggiungibilità del cloud (Supabase). Prima di questo check i sei sopra erano TUTTI sul DB
    // locale: un outage del cloud durato ~54 giorni non ha fatto scattare nulla.
    // Sink spento ⇒ ok:true: è una scelta di configurazione, non un guasto — e non deve far virare
    // l'intero endpoint in `degraded` per chi non usa il mirror cloud.
    try {
        // 3s e non il default di 5: questo è l'UNICO check non locale della lista, e un monitor
        // esterno che interroga /deep ha tipicamente un timeout di 5-10s — attenderne 5 qui
        // rischia di far scadere il monitor stesso, trasformando «mirror cloud giù» in «bot giù».
        const cloud = await checkCloudConnectivity(3_000);
        checks.cloudSupabase = {
            ok: !cloud.configured || cloud.reachable,
            detail: cloud.configured ? cloud.detail : 'disattivato (SUPABASE_SYNC_ENABLED off o non configurato)',
        };
        if (cloud.configured && !cloud.reachable) allOk = false;
    } catch (err: unknown) {
        checks.cloudSupabase = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        allOk = false;
    }

    const statusCode = allOk ? 200 : 503;
    res.status(statusCode).json({
        status: allOk ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        checks,
    });
});
