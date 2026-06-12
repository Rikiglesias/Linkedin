/**
 * api/routes/controls.ts
 * ─────────────────────────────────────────────────────────────────
 * Route REST per i controlli operativi: pause, resume, quarantine, trigger-run.
 * Estratto da server.ts per modularità.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { enqueueAutomationCommand, recordSecurityAuditEvent } from '../../core/repositories';
import { handleApiError } from '../utils';
import { handlePauseAction, handleResumeAction, handleQuarantineAction } from '../helpers/controlActions';
import { resolveRequestIp } from '../helpers/requestIp';
import { mapLegacyTriggerRunWorkflow } from '../../automation/types';
import { runCodebaseAudit } from '../../scripts/codebaseAudit';
import { runGdprRetentionCleanup } from '../../scripts/gdprRetentionCleanup';

const router = Router();

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
        const mapped = mapLegacyTriggerRunWorkflow(workflow);
        if (!mapped) {
            res.status(400).json({ success: false, error: `Workflow legacy non supportato: ${workflow}` });
            return;
        }
        const queued = await enqueueAutomationCommand(
            mapped.kind,
            mapped.payload,
            'dashboard',
            `dashboard:${workflow}:${randomUUID()}`,
        );
        void recordSecurityAuditEvent({
            category: 'runtime_control',
            action: 'trigger_run',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: { workflow, requestId: queued.command.requestId, kind: queued.command.kind },
        }).catch(() => null);
        res.json({
            success: true,
            requestId: queued.command.requestId,
            kind: queued.command.kind,
            message: `Run "${workflow}" schedulato. Verrà eseguito al prossimo ciclo.`,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.trigger-run');
    }
});

// GDPR retention cleanup on-demand (goal gdpr-erasure-cloud T6): canale per il workflow n8n
// `gdpr-retention-cleanup` che prima POSTava workflow inesistenti a /trigger-run -> 400 silenziato
// (onError:continue mandava un Telegram "✅" FALSO). Endpoint DEDICATO sincrono: esegue
// runGdprRetentionCleanup e ritorna il report reale (n8n ha timeout lunghi; admin-only, dietro
// l'auth+rate-limit del controls router). dryRun=true => solo conteggio, nessuna scrittura.
router.post('/gdpr-cleanup', async (req, res) => {
    try {
        const dryRun = req.body?.dryRun === true || req.query?.dryRun === 'true';
        const report = await runGdprRetentionCleanup({ dryRun });
        void recordSecurityAuditEvent({
            category: 'runtime_control',
            action: 'gdpr_cleanup',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: { dryRun, anonymized: report.anonymized, deleted: report.deleted, errors: report.errors.length },
        }).catch(() => null);
        res.json({
            success: true,
            dryRun,
            report,
            message: `GDPR retention ${dryRun ? '(dry-run) ' : ''}completata: ${report.anonymized} anonimizzati, ${report.deleted} cancellati.`,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.gdpr-cleanup');
    }
});

router.get('/codebase-audit', async (_req, res) => {
    try {
        const result = await runCodebaseAudit();
        res.json(result);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.codebase-audit');
    }
});

export default router;
