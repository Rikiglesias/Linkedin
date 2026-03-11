import { Router } from 'express';
import {
    getAiQualitySnapshot,
    listCommentSuggestionsForReview,
    reviewCommentSuggestion,
    runAiValidationPipeline,
} from '../../core/repositories';
import { handleApiError } from '../utils';
import { resolveRequestIp } from '../helpers/requestIp';
import { auditSecurityEvent } from '../helpers/audit';

export const aiRouter = Router();

aiRouter.get('/ai/quality', async (req, res) => {
    try {
        const rawDays = Number.parseInt(String(req.query.days ?? '30'), 10);
        const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(180, rawDays)) : 30;
        const snapshot = await getAiQualitySnapshot(days);
        res.json(snapshot);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ai.quality');
    }
});

aiRouter.post('/ai/quality/run', async (req, res) => {
    try {
        const triggeredBy =
            typeof req.body?.triggeredBy === 'string' && req.body.triggeredBy.trim()
                ? req.body.triggeredBy.trim()
                : 'dashboard';
        const run = await runAiValidationPipeline(triggeredBy);
        auditSecurityEvent({
            category: 'ai_quality',
            action: 'validation_run',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: { runId: run.id, status: run.status },
        });
        res.json(run);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ai.quality.run');
    }
});

aiRouter.get('/ai/comment-suggestions', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;
        const rawStatus =
            typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : 'REVIEW_PENDING';
        if (rawStatus !== 'REVIEW_PENDING' && rawStatus !== 'APPROVED' && rawStatus !== 'REJECTED') {
            res.status(400).json({ error: 'Parametro status non valido.' });
            return;
        }
        const rows = await listCommentSuggestionsForReview(limit, rawStatus);
        res.json({ status: rawStatus, count: rows.length, rows });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ai.comment-suggestions');
    }
});

aiRouter.post('/ai/comment-suggestions/:leadId/:suggestionIndex/approve', async (req, res) => {
    const leadId = Number.parseInt(String(req.params.leadId ?? ''), 10);
    const suggestionIndex = Number.parseInt(String(req.params.suggestionIndex ?? ''), 10);
    if (!Number.isFinite(leadId) || leadId <= 0 || !Number.isFinite(suggestionIndex) || suggestionIndex < 0) {
        res.status(400).json({ error: 'Parametri non validi.' });
        return;
    }
    try {
        const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : undefined;
        const result = await reviewCommentSuggestion({
            leadId, suggestionIndex, action: 'approve', reviewer: resolveRequestIp(req), comment,
        });
        auditSecurityEvent({
            category: 'ai_quality', action: 'comment_suggestion_approve',
            actor: resolveRequestIp(req), result: 'ALLOW',
            metadata: { leadId, suggestionIndex },
        });
        res.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (message.startsWith('lead_not_found:') || message.startsWith('comment_suggestion_not_found:')) {
            res.status(404).json({ error: 'Suggestion non trovata.' });
            return;
        }
        handleApiError(res, err, 'api.ai.comment-suggestions.approve');
    }
});

aiRouter.post('/ai/comment-suggestions/:leadId/:suggestionIndex/reject', async (req, res) => {
    const leadId = Number.parseInt(String(req.params.leadId ?? ''), 10);
    const suggestionIndex = Number.parseInt(String(req.params.suggestionIndex ?? ''), 10);
    if (!Number.isFinite(leadId) || leadId <= 0 || !Number.isFinite(suggestionIndex) || suggestionIndex < 0) {
        res.status(400).json({ error: 'Parametri non validi.' });
        return;
    }
    try {
        const result = await reviewCommentSuggestion({
            leadId, suggestionIndex, action: 'reject', reviewer: resolveRequestIp(req),
        });
        auditSecurityEvent({
            category: 'ai_quality', action: 'comment_suggestion_reject',
            actor: resolveRequestIp(req), result: 'ALLOW',
            metadata: { leadId, suggestionIndex },
        });
        res.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (message.startsWith('lead_not_found:') || message.startsWith('comment_suggestion_not_found:')) {
            res.status(404).json({ error: 'Suggestion non trovata.' });
            return;
        }
        handleApiError(res, err, 'api.ai.comment-suggestions.reject');
    }
});
