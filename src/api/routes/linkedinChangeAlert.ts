/**
 * API endpoint per ricevere alert dal workflow n8n di monitoring LinkedIn.
 *
 * POST /api/linkedin-change-alert
 * Body: { severity, source, title, url, action }
 *
 * Azioni:
 *   - pause: chiama pauseAutomation() e mette il bot in pausa
 *   - warn: invia alert Telegram e logga
 *   - log: solo logging (per weekly digest)
 */

import { Router } from 'express';
import { pauseAutomation } from '../../risk/incidentManager';
import { broadcast } from '../../telemetry/broadcaster';
import { logInfo, logWarn } from '../../telemetry/logger';
import { createIncident, pushOutboxEvent } from '../../core/repositories';
import { LinkedinChangeAlertSchema } from '../schemas';

export const linkedinChangeAlertRouter = Router();

linkedinChangeAlertRouter.post('/', async (req, res) => {
    try {
        const parsed = LinkedinChangeAlertSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            await logWarn('linkedin_change_alert.validation', {
                error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
            });
            res.status(400).json({ ok: false, error: 'Invalid alert payload' });
            return;
        }
        const { severity, source, title, url, action, details } = parsed.data;

        await logInfo('linkedin_change_alert.received', {
            severity,
            source,
            title: title.substring(0, 200),
            url: url.substring(0, 500),
            action,
        });

        // Registra l'alert come incident per tracking storico
        const incidentId = await createIncident(
            `LINKEDIN_CHANGE_${severity.toUpperCase()}`,
            severity === 'critical' ? 'CRITICAL' : 'WARN',
            { source, title, url, action, details: details.substring(0, 1000) },
        );

        // Outbox event per sync
        await pushOutboxEvent(
            'linkedin.change_alert',
            { incidentId, severity, source, title, url, action },
            `linkedin.change_alert:${incidentId}`,
        );

        if (action === 'pause') {
            // CRITICAL: LinkedIn ha cambiato qualcosa di importante → pausa automatica
            const pauseMinutes = severity === 'critical' ? 120 : 60;
            await pauseAutomation(
                'LINKEDIN_CHANGE_DETECTED',
                { incidentId, severity, source, title, url },
                pauseMinutes,
            );
            await broadcast({
                level: 'CRITICAL',
                title: `LinkedIn Change: ${title.substring(0, 100)}`,
                body: `Automazione in pausa per ${pauseMinutes} min.\nFonte: ${source}\n${url ? `Link: ${url}` : ''}${details ? `\nDettagli: ${details.substring(0, 300)}` : ''}`,
                // L5-LI.1 "DO" (A11-1-pop): cambiamento LinkedIn → verifica selettori/DOM prima del resume.
                action: 'Verifica il cambiamento LinkedIn segnalato (selettori/DOM/policy) e aggiorna i selettori se rotti. L\'automazione è in pausa: fai resume manuale SOLO dopo la verifica.',
            });
            res.json({ ok: true, action: 'paused', incidentId, pauseMinutes });
        } else if (action === 'warn') {
            // HIGH: alert importante ma non bloccante
            await broadcast({
                level: 'WARNING',
                title: `LinkedIn Change: ${title.substring(0, 100)}`,
                body: `Fonte: ${source}\n${url ? `Link: ${url}` : ''}${details ? `\nDettagli: ${details.substring(0, 300)}` : ''}`,
                // L5-LI.1 "DO" (A11-1-pop): DO spostato dal body al campo strutturato (coerenza A11-1).
                action: 'Verifica il cambiamento LinkedIn segnalato entro 24h (selettori/DOM/policy). Non bloccante: l\'automazione prosegue.',
            });
            res.json({ ok: true, action: 'warned', incidentId });
        } else {
            // MEDIUM: solo logging per weekly digest
            await logInfo('linkedin_change_alert.logged', { incidentId, severity, title: title.substring(0, 100) });
            res.json({ ok: true, action: 'logged', incidentId });
        }
    } catch (err) {
        await logWarn('linkedin_change_alert.error', {
            error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({ ok: false, error: 'Internal error processing alert' });
    }
});
