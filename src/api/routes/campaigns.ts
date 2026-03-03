import { Router, Request, Response } from 'express';
import { sendApiV1, handleApiError } from '../utils';
import {
    createCampaign,
    listCampaigns,
    getCampaignById,
    updateCampaignStatus,
    addCampaignStep,
    getCampaignSteps,
    enrollLeadInCampaign
} from '../../core/repositories/campaigns';

const router = Router();

// GET /api/v1/campaigns — list all campaigns
router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
        const onlyActive = req.query.onlyActive === 'true' || req.query.onlyActive === '1';
        const campaigns = await listCampaigns(onlyActive);
        sendApiV1(res, { campaigns });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.campaigns.list');
    }
});

// POST /api/v1/campaigns — create a new campaign
router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
        const { name } = req.body ?? {};
        if (!name) {
            res.status(400).json({ error: 'name obbligatorio.' });
            return;
        }
        const campaign = await createCampaign(name);
        sendApiV1(res, { campaign }, 201);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.campaigns.create');
    }
});

// GET /api/v1/campaigns/:id — get a single campaign
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const campaignId = Number.parseInt(String(req.params.id), 10);
        if (!Number.isFinite(campaignId) || campaignId <= 0) {
            res.status(400).json({ error: 'campaignId non valido.' });
            return;
        }
        const campaign = await getCampaignById(campaignId);
        if (!campaign) {
            res.status(404).json({ error: 'Campagna non trovata.' });
            return;
        }
        sendApiV1(res, { campaign });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.campaigns.get');
    }
});

// PATCH /api/v1/campaigns/:id — modify campaign (e.g. deactivate)
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const campaignId = Number.parseInt(String(req.params.id), 10);
        if (!Number.isFinite(campaignId) || campaignId <= 0) {
            res.status(400).json({ error: 'campaignId non valido.' });
            return;
        }
        const { active } = req.body ?? {};
        if (typeof active !== 'boolean') {
            res.status(400).json({ error: 'active (boolean) obbligatorio.' });
            return;
        }
        const updated = await updateCampaignStatus(campaignId, active);
        if (!updated) {
            res.status(404).json({ error: 'Campagna non trovata o non modificata.' });
            return;
        }
        sendApiV1(res, { success: true, campaignId, active });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.campaigns.patch');
    }
});

// GET /api/v1/campaigns/:id/steps — list all steps of a campaign
router.get('/:id/steps', async (req: Request, res: Response): Promise<void> => {
    try {
        const campaignId = Number.parseInt(String(req.params.id), 10);
        if (!Number.isFinite(campaignId) || campaignId <= 0) {
            res.status(400).json({ error: 'campaignId non valido.' });
            return;
        }
        const steps = await getCampaignSteps(campaignId);
        sendApiV1(res, { steps });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.campaigns.steps.list');
    }
});

// POST /api/v1/campaigns/:id/steps — add a step
router.post('/:id/steps', async (req: Request, res: Response): Promise<void> => {
    try {
        const campaignId = Number.parseInt(String(req.params.id), 10);
        if (!Number.isFinite(campaignId) || campaignId <= 0) {
            res.status(400).json({ error: 'campaignId non valido.' });
            return;
        }
        const { stepOrder, actionType, delayHours, metadata } = req.body ?? {};
        const validActions = ['VIEW_PROFILE', 'LIKE_POST', 'FOLLOW', 'INVITE', 'MESSAGE', 'EMAIL_ENRICHMENT'];
        if (!validActions.includes(actionType)) {
            res.status(400).json({ error: `actionType non valido. Valori accettati: ${validActions.join(', ')}` });
            return;
        }
        const step = await addCampaignStep(
            campaignId,
            Number(stepOrder ?? 1),
            String(actionType),
            Number(delayHours ?? 24),
            metadata ? JSON.stringify(metadata) : '{}'
        );
        sendApiV1(res, { step }, 201);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.campaigns.steps.add');
    }
});

// POST /api/v1/campaigns/:id/enroll — enroll a lead
router.post('/:id/enroll', async (req: Request, res: Response): Promise<void> => {
    try {
        const campaignId = Number.parseInt(String(req.params.id), 10);
        const leadId = Number.parseInt(String(req.body?.leadId), 10);
        const firstStepId = Number.parseInt(String(req.body?.firstStepId ?? ''), 10);
        const nextExecAt = String(req.body?.nextExecutionAt ?? new Date().toISOString());

        if (!Number.isFinite(campaignId) || campaignId <= 0 || !Number.isFinite(leadId)) {
            res.status(400).json({ error: 'campaignId e leadId validi sono obbligatori.' });
            return;
        }

        await enrollLeadInCampaign(leadId, campaignId, Number.isFinite(firstStepId) ? firstStepId : 0, nextExecAt);
        sendApiV1(res, { success: true, leadId, campaignId }, 201);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.campaigns.enroll');
    }
});

export default router;
