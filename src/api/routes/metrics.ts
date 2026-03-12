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
import { getProxyPoolStatus, getProxyQualityStatus } from '../../proxyManager';

const router = Router();

const RISK_ACTION_MAP: Record<string, number> = { GO: 0, SLOW: 1, STOP: 2 };

router.get('/', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const db = await getDatabase();
        const { getDailyStat, getRiskInputs } = await import('../../core/repositories');

        const [
            invitesSent, messagesSent, runErrors, challenges, selectorFailures,
            acceptances, followUpsSent, profileViews, likesGiven, followsGiven,
            riskInputs,
        ] = await Promise.all([
            getDailyStat(localDate, 'invites_sent'),
            getDailyStat(localDate, 'messages_sent'),
            getDailyStat(localDate, 'run_errors'),
            getDailyStat(localDate, 'challenges_count'),
            getDailyStat(localDate, 'selector_failures'),
            getDailyStat(localDate, 'acceptances'),
            getDailyStat(localDate, 'follow_ups_sent'),
            getDailyStat(localDate, 'profile_views'),
            getDailyStat(localDate, 'likes_given'),
            getDailyStat(localDate, 'follows_given'),
            getRiskInputs(localDate, config.hardInviteCap),
        ]);
        const riskSnapshot = evaluateRisk(riskInputs);

        const queueRow = await db.get<{ total: number | string }>(
            "SELECT COUNT(*) as total FROM jobs WHERE status = 'QUEUED'",
        );
        const queueDepth = queueRow ? Number(queueRow.total) : 0;

        const proxy = getProxyPoolStatus();
        const qualityStatus = await getProxyQualityStatus();

        const lines = [
            // ── Funnel metrics ────────────────────────────────────────────
            '# HELP lkbot_invites_sent_today Total invites sent today',
            '# TYPE lkbot_invites_sent_today gauge',
            `lkbot_invites_sent_today ${invitesSent}`,
            '# HELP lkbot_messages_sent_today Total messages sent today',
            '# TYPE lkbot_messages_sent_today gauge',
            `lkbot_messages_sent_today ${messagesSent}`,
            '# HELP lkbot_acceptances_today Total connection acceptances today',
            '# TYPE lkbot_acceptances_today gauge',
            `lkbot_acceptances_today ${acceptances}`,
            '# HELP lkbot_follow_ups_sent_today Total follow-up messages sent today',
            '# TYPE lkbot_follow_ups_sent_today gauge',
            `lkbot_follow_ups_sent_today ${followUpsSent}`,
            '# HELP lkbot_profile_views_today Total profile views today',
            '# TYPE lkbot_profile_views_today gauge',
            `lkbot_profile_views_today ${profileViews}`,
            '# HELP lkbot_likes_given_today Total likes given today',
            '# TYPE lkbot_likes_given_today gauge',
            `lkbot_likes_given_today ${likesGiven}`,
            '# HELP lkbot_follows_given_today Total follows given today',
            '# TYPE lkbot_follows_given_today gauge',
            `lkbot_follows_given_today ${followsGiven}`,
            // ── Risk & health ─────────────────────────────────────────────
            '# HELP lkbot_run_errors_today Total run errors today',
            '# TYPE lkbot_run_errors_today gauge',
            `lkbot_run_errors_today ${runErrors}`,
            '# HELP lkbot_challenges_today Total challenges detected today',
            '# TYPE lkbot_challenges_today gauge',
            `lkbot_challenges_today ${challenges}`,
            '# HELP lkbot_selector_failures_today Total selector failures today',
            '# TYPE lkbot_selector_failures_today gauge',
            `lkbot_selector_failures_today ${selectorFailures}`,
            '# HELP lkbot_risk_score Current risk score 0-100',
            '# TYPE lkbot_risk_score gauge',
            `lkbot_risk_score ${riskSnapshot.score}`,
            '# HELP lkbot_risk_action Current risk action (0=GO 1=SLOW 2=STOP)',
            '# TYPE lkbot_risk_action gauge',
            `lkbot_risk_action ${RISK_ACTION_MAP[riskSnapshot.action] ?? 0}`,
            '# HELP lkbot_pending_ratio Pending invite ratio 0-1',
            '# TYPE lkbot_pending_ratio gauge',
            `lkbot_pending_ratio ${riskSnapshot.pendingRatio.toFixed(4)}`,
            // ── Queue ─────────────────────────────────────────────────────
            '# HELP lkbot_queue_depth Number of queued jobs',
            '# TYPE lkbot_queue_depth gauge',
            `lkbot_queue_depth ${queueDepth}`,
            // ── Proxy pool ────────────────────────────────────────────────
            '# HELP lkbot_proxy_ready Number of ready proxies',
            '# TYPE lkbot_proxy_ready gauge',
            `lkbot_proxy_ready ${proxy.ready}`,
            '# HELP lkbot_proxy_total Total configured proxies',
            '# TYPE lkbot_proxy_total gauge',
            `lkbot_proxy_total ${proxy.total}`,
            '# HELP lkbot_proxy_cooling Number of proxies in cooldown',
            '# TYPE lkbot_proxy_cooling gauge',
            `lkbot_proxy_cooling ${proxy.cooling}`,
            '# HELP lkbot_proxy_mobile Number of mobile proxies',
            '# TYPE lkbot_proxy_mobile gauge',
            `lkbot_proxy_mobile ${proxy.mobile}`,
            '# HELP lkbot_proxy_residential Number of residential proxies',
            '# TYPE lkbot_proxy_residential gauge',
            `lkbot_proxy_residential ${proxy.residential}`,
            // ── Proxy quality ─────────────────────────────────────────────
            '# HELP lkbot_proxy_quality_score Overall proxy quality score 0-100',
            '# TYPE lkbot_proxy_quality_score gauge',
            `lkbot_proxy_quality_score ${qualityStatus.quality?.overallScore ?? -1}`,
            '# HELP lkbot_proxy_datacenter_count Number of datacenter proxies detected',
            '# TYPE lkbot_proxy_datacenter_count gauge',
            `lkbot_proxy_datacenter_count ${qualityStatus.quality?.datacenterCount ?? 0}`,
            '# HELP lkbot_proxy_quality_degraded Whether proxy quality is below threshold (1=degraded)',
            '# TYPE lkbot_proxy_quality_degraded gauge',
            `lkbot_proxy_quality_degraded ${qualityStatus.quality?.degraded ? 1 : 0}`,
            // ── JA3/TLS ───────────────────────────────────────────────────
            '# HELP lkbot_ja3_status JA3 spoofing status (0=SECURE 1=GAP 2=DIRECT -1=unknown)',
            '# TYPE lkbot_ja3_status gauge',
            `lkbot_ja3_status ${qualityStatus.ja3 ? ({ SECURE: 0, GAP: 1, DIRECT: 2 }[qualityStatus.ja3.status] ?? -1) : -1}`,
            '# HELP lkbot_ja3_cycletls_active Whether CycleTLS is active (1=yes 0=no)',
            '# TYPE lkbot_ja3_cycletls_active gauge',
            `lkbot_ja3_cycletls_active ${qualityStatus.ja3?.cycleTlsActive ? 1 : 0}`,
            '',
        ];

        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(lines.join('\n'));
    } catch (err: unknown) {
        res.status(500).send(`# error generating metrics: ${err instanceof Error ? err.message : 'unknown'}\n`);
    }
});

export default router;
