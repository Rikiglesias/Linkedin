/**
 * missMetricsAudit.ts — Misura miss reali per ogni regola critica
 *
 * Legge i log dei hook in ~/memory/*-log.txt e produce metriche:
 * - hit count per finestra temporale (7d / 30d / totale)
 * - trend ascendente/discendente/stabile
 * - candidate per promozione a blocking (advisory con miss ricorrenti)
 *
 * Base per Item 13 del backlog AI: autonomia, metriche, sistema che migliora se stesso.
 * Senza questo audit, ogni nuova regola si aggiunge alle altre e si dimentica allo stesso modo.
 *
 * Uso:
 *   npm run audit:miss-metrics
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface RuleSpec {
    logFile: string;
    label: string;
    type: 'blocking' | 'advisory' | 'cognitive' | 'audit';
    candidatePromotion: boolean;
}

interface RuleMetrics {
    label: string;
    type: string;
    last7d: number;
    last30d: number;
    total: number;
    trend: '↑' | '↓' | '→' | '-';
    promotionRecommendation: string;
}

const RULES: RuleSpec[] = [
    { logFile: 'antiban-hook-log.txt', label: 'antiban-hook', type: 'blocking', candidatePromotion: false },
    { logFile: 'best-practice-log.txt', label: 'best-practice', type: 'advisory', candidatePromotion: true },
    { logFile: 'codebase-hygiene-log.txt', label: 'codebase-hygiene', type: 'advisory', candidatePromotion: true },
    { logFile: 'compact-handoff-log.txt', label: 'compact-handoff', type: 'blocking', candidatePromotion: false },
    { logFile: 'git-hook-log.txt', label: 'git-hook', type: 'audit', candidatePromotion: false },
    { logFile: 'model-suggestion-log.txt', label: 'model-suggestion', type: 'cognitive', candidatePromotion: false },
    { logFile: 'proactive-next-step-log.txt', label: 'proactive-next-step', type: 'advisory', candidatePromotion: true },
    { logFile: 'quality-hook-log.txt', label: 'quality-hook', type: 'blocking', candidatePromotion: false },
    { logFile: 'recap-check-log.txt', label: 'recap-check', type: 'advisory', candidatePromotion: true },
    { logFile: 'routing-log.txt', label: 'routing', type: 'cognitive', candidatePromotion: false },
    { logFile: 'rule-violations-log.txt', label: 'rule-violations', type: 'audit', candidatePromotion: false },
    { logFile: 'secrets-hook-log.txt', label: 'secrets-hook', type: 'blocking', candidatePromotion: false },
    { logFile: 'stop-commit-gate-log.txt', label: 'stop-commit-gate', type: 'blocking', candidatePromotion: false },
    { logFile: 'websearch-log.txt', label: 'websearch', type: 'cognitive', candidatePromotion: false },
    { logFile: 'skill-precheck-log.txt', label: 'skill-precheck', type: 'advisory', candidatePromotion: true },
];

const MEMORY_DIR = join(homedir(), 'memory');
const PROMOTION_THRESHOLD_7D = 5;
const TREND_PCT = 25;

function parseLogLines(logPath: string): string[] {
    if (!existsSync(logPath)) return [];
    try {
        const content = readFileSync(logPath, 'utf8');
        return content.split('\n').filter((l) => l.trim().length > 0);
    } catch {
        return [];
    }
}

function extractDate(line: string): string | null {
    const m = line.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}

function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}

function countInWindow(lines: string[], fromDate: string): number {
    return lines.filter((l) => {
        const d = extractDate(l);
        return d !== null && d >= fromDate;
    }).length;
}

function computeTrend(last7d: number, last30d: number): RuleMetrics['trend'] {
    if (last30d === 0) return '-';
    const averagePer7d = last30d / (30 / 7);
    if (averagePer7d === 0) return '-';
    const pctDiff = ((last7d - averagePer7d) / averagePer7d) * 100;
    if (pctDiff > TREND_PCT) return '↑';
    if (pctDiff < -TREND_PCT) return '↓';
    return '→';
}

function computeRecommendation(spec: RuleSpec, metrics: { last7d: number; last30d: number }): string {
    if (!spec.candidatePromotion) {
        if (spec.type === 'blocking') return 'gia\' blocking';
        if (spec.type === 'cognitive') return 'cognitive (no promozione meccanizzabile)';
        if (spec.type === 'audit') return 'audit-only';
        return '-';
    }
    if (metrics.last7d >= PROMOTION_THRESHOLD_7D) {
        return `PROMUOVI a blocking (${metrics.last7d}/7d >= ${PROMOTION_THRESHOLD_7D})`;
    }
    if (metrics.last30d >= PROMOTION_THRESHOLD_7D * 4) {
        return `valuta promozione (${metrics.last30d}/30d sostenuto)`;
    }
    return 'mantieni advisory (frequenza bassa)';
}

function computeMetrics(spec: RuleSpec): RuleMetrics {
    const logPath = join(MEMORY_DIR, spec.logFile);
    const lines = parseLogLines(logPath);
    const last7d = countInWindow(lines, daysAgo(7));
    const last30d = countInWindow(lines, daysAgo(30));
    return {
        label: spec.label,
        type: spec.type,
        last7d,
        last30d,
        total: lines.length,
        trend: computeTrend(last7d, last30d),
        promotionRecommendation: computeRecommendation(spec, { last7d, last30d }),
    };
}

function padRight(s: string, n: number): string {
    if (s.length >= n) return s.substring(0, n);
    return s + ' '.repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
    if (s.length >= n) return s.substring(0, n);
    return ' '.repeat(n - s.length) + s;
}

function run(): void {
    console.log('=== Miss Metrics Audit ===\n');
    const today = new Date().toISOString().slice(0, 10);
    console.log(`Data: ${today}`);
    console.log(`Finestre: 7d / 30d / totale | Soglia promozione: ${PROMOTION_THRESHOLD_7D}/7d\n`);

    const results = RULES.map(computeMetrics).sort((a, b) => b.last7d - a.last7d);

    const headers = ['Regola', 'Tipo', '7d', '30d', 'Tot', 'Trend', 'Promozione'];
    const widths = [22, 10, 5, 5, 6, 6, 50];

    console.log(headers.map((h, i) => padRight(h, widths[i])).join('| '));
    console.log(widths.map((w) => '-'.repeat(w)).join('+-'));

    for (const r of results) {
        console.log(
            [
                padRight(r.label, widths[0]),
                padRight(r.type, widths[1]),
                padLeft(String(r.last7d), widths[2]),
                padLeft(String(r.last30d), widths[3]),
                padLeft(String(r.total), widths[4]),
                padRight(r.trend, widths[5]),
                padRight(r.promotionRecommendation, widths[6]),
            ].join('| '),
        );
    }

    const candidatesToPromote = results.filter((r) => r.promotionRecommendation.startsWith('PROMUOVI'));
    const candidatesToConsider = results.filter((r) => r.promotionRecommendation.startsWith('valuta'));

    console.log('\n--- Sintesi ---');
    console.log(`Candidate forti per promozione blocking: ${candidatesToPromote.length}`);
    candidatesToPromote.forEach((r) => console.log(`  - ${r.label}: ${r.last7d}/7d`));
    console.log(`Candidate da valutare: ${candidatesToConsider.length}`);
    candidatesToConsider.forEach((r) => console.log(`  - ${r.label}: ${r.last30d}/30d`));

    const stale = results.filter((r) => r.total === 0);
    if (stale.length > 0) {
        console.log(`\nRegole senza miss registrati: ${stale.length} (verifica che il log si scriva davvero)`);
        stale.forEach((r) => console.log(`  - ${r.label}`));
    }

    console.log('\nOK — audit informativo, non blocca chiusura.');
}

run();
