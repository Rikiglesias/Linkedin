import express from 'express';
import cors from 'cors';
import path from 'path';
import { getGlobalKPIData, getRiskInputs, getABTestingStats } from '../core/repositories';
import { getDatabase } from '../db';
import { evaluateRisk } from '../risk/riskEngine';
import { getLocalDateString, config } from '../config';
import { pauseAutomation, resumeAutomation, setQuarantine } from '../risk/incidentManager';
import { CampaignRunRecord } from '../types/domain';

const app = express();
app.use(cors());
app.use(express.json());

// Serves the public directory (Dashboard UI)
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// KPIs endpoint
app.get('/api/kpis', async (req, res) => {
    try {
        const kpi = await getGlobalKPIData();
        const localDate = getLocalDateString();
        const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const risk = await evaluateRisk(riskInputs);
        const db = await getDatabase();

        const runtimePause = await db.get(`SELECT value FROM runtime_flags WHERE key = 'automation_paused_until'`);
        const isQuarantined = await db.get(`SELECT value FROM runtime_flags WHERE key = 'account_quarantine'`);

        res.json({
            funnel: {
                totalLeads: kpi.totalLeads,
                invited: kpi.statusCounts['INVITED'] || 0,
                accepted: kpi.statusCounts['ACCEPTED'] || 0,
                readyMessage: kpi.statusCounts['READY_MESSAGE'] || 0,
                messaged: kpi.statusCounts['MESSAGED'] || 0,
                replied: kpi.statusCounts['REPLIED'] || 0,
                withdrawn: kpi.statusCounts['WITHDRAWN'] || 0
            },
            risk: risk,
            activeCampaigns: kpi.activeCampaigns,
            system: {
                pausedUntil: runtimePause?.value || null,
                quarantined: isQuarantined?.value === 'true'
            }
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('API Error', message);
        res.status(500).json({ error: message });
    }
});

// Recent runs
app.get('/api/runs', async (req, res) => {
    try {
        const db = await getDatabase();
        const runs = await db.all<CampaignRunRecord[]>(`SELECT * FROM campaign_runs ORDER BY id DESC LIMIT 10`);
        res.json(runs);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('API Error', message);
        res.status(500).json({ error: message });
    }
});

// A/B Testing Stats
app.get('/api/ab-testing/stats', async (req, res) => {
    try {
        const stats = await getABTestingStats();
        res.json(stats);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('API Error /ab-testing/stats', message);
        res.status(500).json({ error: message });
    }
});

// Controls
app.post('/api/controls/pause', async (req, res) => {
    try {
        const minutes = req.body.minutes || 1440; // Default 24h
        await pauseAutomation('MANUAL_UI_PAUSE', { source: 'dashboard' }, minutes);
        res.json({ success: true, message: `Paused for ${minutes} minutes` });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

app.post('/api/controls/resume', async (req, res) => {
    try {
        await resumeAutomation();
        res.json({ success: true, message: 'Resumed' });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

app.post('/api/controls/quarantine', async (req, res) => {
    try {
        const enabled = req.body.enabled === true;
        await setQuarantine(enabled);
        res.json({ success: true, message: `Quarantine set to ${enabled}` });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

export function startServer(port: number = 3000) {
    return app.listen(port, () => {
        console.log(`\n🚀 Dashboard & Web API is running on http://localhost:${port}\n`);
    });
}
