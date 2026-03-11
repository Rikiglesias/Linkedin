import { Router } from 'express';
import {
    getLeadsByStatus,
    getRuntimeFlag,
    listAccountHealthSnapshots,
    listLatestAccountHealthSnapshots,
    listOpenIncidents,
    listRecentBackupRuns,
    listSecurityAuditEvents,
} from '../../core/repositories';
import { handleApiError } from '../utils';

export const securityRouter = Router();

securityRouter.get('/accounts/health', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;
        const accountId = typeof req.query.accountId === 'string' ? req.query.accountId.trim() : '';
        const rows = accountId
            ? await listAccountHealthSnapshots(accountId, limit)
            : await listLatestAccountHealthSnapshots(limit);
        res.json({ accountId: accountId || null, count: rows.length, rows });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.accounts.health');
    }
});

securityRouter.get('/security/audit', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;
        const category = typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
        const rows = await listSecurityAuditEvents(limit, category);
        res.json({ count: rows.length, rows });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.security.audit');
    }
});

securityRouter.get('/backups', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '20'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;
        const rows = await listRecentBackupRuns(limit);
        res.json({ count: rows.length, rows });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.backups');
    }
});

securityRouter.get('/review-queue', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;
        const [reviewLeads, incidents, challengePendingFlag, lastIncidentId] = await Promise.all([
            getLeadsByStatus('REVIEW_REQUIRED', limit),
            listOpenIncidents(),
            getRuntimeFlag('challenge_review_pending'),
            getRuntimeFlag('challenge_review_last_incident_id'),
        ]);
        const challengeIncidents = incidents.filter((incident) => incident.type === 'CHALLENGE_DETECTED');
        res.json({
            pending: challengePendingFlag === 'true',
            lastIncidentId: lastIncidentId ? Number.parseInt(lastIncidentId, 10) : null,
            reviewLeadCount: reviewLeads.length,
            challengeIncidentCount: challengeIncidents.length,
            leads: reviewLeads.map((lead) => ({
                id: lead.id,
                status: lead.status,
                listName: lead.list_name,
                firstName: lead.first_name,
                lastName: lead.last_name,
                linkedinUrl: lead.linkedin_url,
                updatedAt: lead.updated_at,
                lastError: lead.last_error,
            })),
            incidents: challengeIncidents,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.review-queue');
    }
});
