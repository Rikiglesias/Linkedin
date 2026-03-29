/**
 * api/routes/leads.ts
 * ─────────────────────────────────────────────────────────────────
 * Route REST per ricerca e dettaglio lead.
 * Estratto da server.ts per modularità.
 */

import { Router } from 'express';
import { searchLeads, getLeadById, getLeadTimeline } from '../../core/repositories';
import { handleApiError } from '../utils';

const router = Router();

router.get('/search', async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const listName = typeof req.query.list === 'string' ? req.query.list : undefined;
        const page = typeof req.query.page === 'string' ? Math.max(1, parseInt(req.query.page, 10) || 1) : 1;
        const pageSize =
            typeof req.query.pageSize === 'string' ? Math.min(100, parseInt(req.query.pageSize, 10) || 25) : 25;

        const result = await searchLeads({
            query: query || undefined,
            status: status as never,
            listName: listName || undefined,
            page,
            pageSize,
        });

        res.json(result);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.leads.search');
    }
});

router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id) || id <= 0) {
            res.status(400).json({ error: 'Invalid lead ID' });
            return;
        }
        const lead = await getLeadById(id);
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }
        const timeline = await getLeadTimeline(id);
        res.json({ lead, timeline });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.leads.detail');
    }
});

export default router;
