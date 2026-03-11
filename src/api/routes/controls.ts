/**
 * api/routes/controls.ts
 * ─────────────────────────────────────────────────────────────────
 * Route REST per i controlli operativi: pause, resume, quarantine, trigger-run.
 * Estratto da server.ts per modularità.
 */

import { Router } from 'express';
import { setRuntimeFlag, recordSecurityAuditEvent } from '../../core/repositories';
import { handleApiError } from '../utils';
import { handlePauseAction, handleResumeAction, handleQuarantineAction } from '../helpers/controlActions';
import type { Request } from 'express';

const router = Router();

function resolveRequestIp(req: Request): string {
    const fromExpress = (req.ip ?? '').trim();
    if (fromExpress && fromExpress !== '::1') return fromExpress.startsWith('::ffff:') ? fromExpress.slice(7) : fromExpress;
    if (fromExpress === '::1') return '127.0.0.1';
    const fallback = req.socket?.remoteAddress ?? '';
    return fallback.trim().startsWith('::ffff:') ? fallback.trim().slice(7) : fallback.trim();
}

router.post('/pause', async (req, res) => {
    try {
        const result = await handlePauseAction(req, 'dashboard');
        res.json({ ...result, message: `Pausa attivata per ${result.minutes} minuti.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.pause');
    }
});

router.post('/resume', async (req, res) => {
    try {
        await handleResumeAction(req, 'dashboard');
        res.json({ success: true, message: 'Ripresa automazione.' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.resume');
    }
});

router.post('/quarantine', async (req, res) => {
    try {
        const result = await handleQuarantineAction(req, 'dashboard');
        res.json({ success: true, message: `Quarantena ${result.enabled ? 'attivata' : 'disattivata'}.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.quarantine');
    }
});

router.post('/trigger-run', async (req, res) => {
    try {
        const workflow = typeof req.body?.workflow === 'string' ? req.body.workflow : 'all';
        const validWorkflows = ['invite', 'check', 'message', 'warmup', 'all'];
        if (!validWorkflows.includes(workflow)) {
            res.status(400).json({ success: false, error: `Workflow non valido: ${workflow}` });
            return;
        }
        await setRuntimeFlag('ui_trigger_run', JSON.stringify({
            workflow,
            requestedAt: new Date().toISOString(),
            source: 'dashboard',
        }));
        void recordSecurityAuditEvent({
            category: 'runtime_control',
            action: 'trigger_run',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: { workflow },
        }).catch(() => null);
        res.json({ success: true, message: `Run "${workflow}" schedulato. Verrà eseguito al prossimo ciclo.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.trigger-run');
    }
});

export default router;
