/**
 * api/routes/metrics.ts
 * ─────────────────────────────────────────────────────────────────
 * Endpoint Prometheus /metrics — esporta metriche in formato text/plain.
 * Estratto da server.ts per ridurre la dimensione del file principale.
 */

import { Router } from 'express';
import { getDatabase } from '../../db';
import { evaluateRisk } from '../../risk/riskEngine';
import { getLocalDateString, config } from '../../config';

const router = Router();

router.get('/', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const db = await getDatabase();
        const { getDailyStat, getRiskInputs } = await import('../../core/repositories');

        const [invitesSent, messagesSent, runErrors, challenges, selectorFailures, riskInputs] = await Promise.all([
            getDailyStat(localDate, 'invites_sent'),
            getDailyStat(localDate, 'messages_sent'),
            getDailyStat(localDate, 'run_errors'),
            getDailyStat(localDate, 'challenges_count'),
            getDailyStat(localDate, 'selector_failures'),
            getRiskInputs(localDate, config.hardInviteCap),
        ]);
        const riskSnapshot = evaluateRisk(riskInputs);

        const queueRow = await db.get<{ total: number | string }>(
            "SELECT COUNT(*) as total FROM jobs WHERE status = 'QUEUED'",
        );
        const queueDepth = queueRow ? Number(queueRow.total) : 0;

        const { getProxyPoolStatus: getProxyPool } = await import('../../proxyManager');
        const proxy = getProxyPool();

        const lines = [
            '# HELP lkbot_invites_sent_today Total invites sent today',
            '# TYPE lkbot_invites_sent_today gauge',
            `lkbot_invites_sent_today ${invitesSent}`,
            '# HELP lkbot_messages_sent_today Total messages sent today',
            '# TYPE lkbot_messages_sent_today gauge',
            `lkbot_messages_sent_today ${messagesSent}`,
            '# HELP lkbot_run_errors_today Total run errors today',
            '# TYPE lkbot_run_errors_today gauge',
            `lkbot_run_errors_today ${runErrors}`,
            '# HELP lkbot_challenges_today Total challenges detected today',
            '# TYPE lkbot_challenges_today gauge',
            `lkbot_challenges_today ${challenges}`,
            '# HELP lkbot_selector_failures_today Total selector failures today',
            '# TYPE lkbot_selector_failures_today gauge',
            `lkbot_selector_failures_today ${selectorFailures}`,
            '# HELP lkbot_risk_score Current risk score (0-100)',
            '# TYPE lkbot_risk_score gauge',
            `lkbot_risk_score ${riskSnapshot.score}`,
            '# HELP lkbot_queue_depth Number of queued jobs',
            '# TYPE lkbot_queue_depth gauge',
            `lkbot_queue_depth ${queueDepth}`,
            '# HELP lkbot_proxy_ready Number of ready proxies',
            '# TYPE lkbot_proxy_ready gauge',
            `lkbot_proxy_ready ${proxy.ready}`,
            '# HELP lkbot_proxy_total Total configured proxies',
            '# TYPE lkbot_proxy_total gauge',
            `lkbot_proxy_total ${proxy.total}`,
            '# HELP lkbot_proxy_cooling Number of proxies in cooldown',
            '# TYPE lkbot_proxy_cooling gauge',
            `lkbot_proxy_cooling ${proxy.cooling}`,
            '',
        ];

        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(lines.join('\n'));
    } catch (err: unknown) {
        res.status(500).send(`# error generating metrics: ${err instanceof Error ? err.message : 'unknown'}\n`);
    }
});

export default router;
