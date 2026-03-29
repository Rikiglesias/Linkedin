/**
 * api/routes/blacklist.ts
 * ─────────────────────────────────────────────────────────────────
 * Route REST per la gestione della blacklist lead/company.
 * Estratto da server.ts per modularità.
 */

import { Router } from 'express';
import { addToBlacklist, countBlacklist, listBlacklist, removeFromBlacklist } from '../../core/repositories';
import { handleApiError } from '../utils';

const router = Router();

router.get('/', async (_req, res) => {
    try {
        const entries = await listBlacklist(500);
        const total = await countBlacklist();
        res.json({ entries, total });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.blacklist.list');
    }
});

router.post('/', async (req, res) => {
    try {
        const { linkedin_url, company_domain, reason, added_by } = req.body as {
            linkedin_url?: string;
            company_domain?: string;
            reason?: string;
            added_by?: string;
        };
        if (!linkedin_url && !company_domain) {
            res.status(400).json({ error: 'Serve almeno linkedin_url o company_domain.' });
            return;
        }
        if (!reason) {
            res.status(400).json({ error: 'Il campo reason è obbligatorio.' });
            return;
        }
        const id = await addToBlacklist(linkedin_url ?? null, company_domain ?? null, reason, added_by ?? 'dashboard');
        res.status(201).json({ id, message: 'Aggiunto alla blacklist.' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.blacklist.add');
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id) || id <= 0) {
            res.status(400).json({ error: 'ID non valido.' });
            return;
        }
        await removeFromBlacklist(id);
        res.json({ message: 'Rimosso dalla blacklist.' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.blacklist.remove');
    }
});

export default router;
