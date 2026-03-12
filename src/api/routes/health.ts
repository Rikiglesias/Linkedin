import { Router } from 'express';
import { getDatabase } from '../../db';
import { config } from '../../config';
import { getAutomationPauseState, countPendingOutboxEvents } from '../../core/repositories';

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
        const row = await db.get<{ total: number }>('SELECT COUNT(*) as total FROM jobs WHERE status = \'QUEUED\'');
        const queueDepth = row ? Number(row.total) : 0;
        checks.queue = { ok: true, detail: `${queueDepth} queued jobs` };
    } catch {
        checks.queue = { ok: false, detail: 'Unable to read job queue' };
        allOk = false;
    }

    const statusCode = allOk ? 200 : 503;
    res.status(statusCode).json({
        status: allOk ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        checks,
    });
});
