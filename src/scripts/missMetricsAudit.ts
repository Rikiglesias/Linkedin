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
    /** Regex per identificare miss veri (BLOCK/HARD-BLOCK/violation). Se assente, ogni linea conta come activation, non miss. */
    missPattern?: RegExp;
}

interface RuleMetrics {
    label: string;
    type: string;
    activations7d: number;
    activations30d: number;
    activationsTotal: number;
    miss7d: number;
    miss30d: number;
    missTotal: number;
    trend: '↑' | '↓' | '→' | '-';
    promotionRecommendation: string;
}

const RULES: RuleSpec[] = [
    { logFile: 'antiban-hook-log.txt', label: 'antiban-hook', type: 'blocking', candidatePromotion: false, missPattern: /HARD-BLOCK|BLOCKED/i },
    { logFile: 'best-practice-log.txt', label: 'best-practice', type: 'advisory', candidatePromotion: true, missPattern: /BLOCK|violation|missing|skipped/i },
    { logFile: 'codebase-hygiene-log.txt', label: 'codebase-hygiene', type: 'advisory', candidatePromotion: true, missPattern: /BLOCK|violation|skipped|missing/i },
    { logFile: 'compact-handoff-log.txt', label: 'compact-handoff', type: 'blocking', candidatePromotion: false, missPattern: /BLOCK|forced/i },
    { logFile: 'git-hook-log.txt', label: 'git-hook', type: 'audit', candidatePromotion: false, missPattern: /BLOCK|fail|error/i },
    { logFile: 'model-suggestion-log.txt', label: 'model-suggestion', type: 'cognitive', candidatePromotion: false },
    { logFile: 'proactive-next-step-log.txt', label: 'proactive-next-step', type: 'advisory', candidatePromotion: true, missPattern: /BLOCK|violation|missing/i },
    { logFile: 'quality-hook-log.txt', label: 'quality-hook', type: 'blocking', candidatePromotion: false, missPattern: /BLOCK|fail|error/i },
    { logFile: 'recap-check-log.txt', label: 'recap-check', type: 'advisory', candidatePromotion: true, missPattern: /BLOCK|violation|missing/i },
    { logFile: 'routing-log.txt', label: 'routing', type: 'cognitive', candidatePromotion: false },
    { logFile: 'rule-violations-log.txt', label: 'rule-violations', type: 'audit', candidatePromotion: false, missPattern: /./ },
    { logFile: 'secrets-hook-log.txt', label: 'secrets-hook', type: 'blocking', candidatePromotion: false, missPattern: /BLOCK|denied/i },
    { logFile: 'stop-commit-gate-log.txt', label: 'stop-commit-gate', type: 'blocking', candidatePromotion: false, missPattern: /dirty=[1-9]/i },
    { logFile: 'websearch-log.txt', label: 'websearch', type: 'cognitive', candidatePromotion: false },
    { logFile: 'skill-precheck-log.txt', label: 'skill-precheck', type: 'advisory', candidatePromotion: true, missPattern: /BLOCK|violation|missing/i },
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

function countMissInWindow(lines: string[], fromDate: string, pattern: RegExp): number {
    return lines.filter((l) => {
        const d = extractDate(l);
        if (d === null || d < fromDate) return false;
        return pattern.test(l);
    }).length;
}

function computeTrend(current: number, baseline30d: number): RuleMetrics['trend'] {
    if (baseline30d === 0) return '-';
    const averagePer7d = baseline30d / (30 / 7);
    if (averagePer7d === 0) return '-';
    const pctDiff = ((current - averagePer7d) / averagePer7d) * 100;
    if (pctDiff > TREND_PCT) return '↑';
    if (pctDiff < -TREND_PCT) return '↓';
    return '→';
}

function computeRecommendation(spec: RuleSpec, metrics: { miss7d: number; miss30d: number; activations7d: number }): string {
    if (!spec.candidatePromotion) {
        if (spec.type === 'blocking') return 'gia\' blocking';
        if (spec.type === 'cognitive') return 'cognitive (no promozione meccanizzabile)';
        if (spec.type === 'audit') return 'audit-only';
        return '-';
    }
    if (!spec.missPattern) {
        return `solo activations (${metrics.activations7d}/7d, no pattern miss)`;
    }
    if (metrics.miss7d >= PROMOTION_THRESHOLD_7D) {
        return `PROMUOVI a blocking (miss ${metrics.miss7d}/7d >= ${PROMOTION_THRESHOLD_7D})`;
    }
    if (metrics.miss30d >= PROMOTION_THRESHOLD_7D * 4) {
        return `valuta promozione (miss ${metrics.miss30d}/30d sostenuto)`;
    }
    return `mantieni advisory (miss ${metrics.miss7d}/7d sotto soglia)`;
}

function computeMetrics(spec: RuleSpec): RuleMetrics {
    const logPath = join(MEMORY_DIR, spec.logFile);
    const lines = parseLogLines(logPath);
    const activations7d = countInWindow(lines, daysAgo(7));
    const activations30d = countInWindow(lines, daysAgo(30));
    const pattern = spec.missPattern;
    const miss7d = pattern ? countMissInWindow(lines, daysAgo(7), pattern) : 0;
    const miss30d = pattern ? countMissInWindow(lines, daysAgo(30), pattern) : 0;
    const missTotal = pattern ? lines.filter((l) => pattern.test(l)).length : 0;
    return {
        label: spec.label,
        type: spec.type,
        activations7d,
        activations30d,
        activationsTotal: lines.length,
        miss7d,
        miss30d,
        missTotal,
        trend: computeTrend(miss7d, miss30d),
        promotionRecommendation: computeRecommendation(spec, { miss7d, miss30d, activations7d }),
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
    console.log(`Activations = ogni trigger del hook | Miss = trigger con BLOCK/violation/dirty pattern`);
    console.log(`Soglia promozione: ${PROMOTION_THRESHOLD_7D} miss/7d\n`);

    const results = RULES.map(computeMetrics).sort((a, b) => b.miss7d - a.miss7d || b.activations7d - a.activations7d);

    const headers = ['Regola', 'Tipo', 'Act 7d', 'Miss 7d', 'Miss 30d', 'Miss Tot', 'Trend miss', 'Raccomandazione'];
    const widths = [22, 10, 7, 8, 9, 9, 11, 50];

    console.log(headers.map((h, i) => padRight(h, widths[i])).join('| '));
    console.log(widths.map((w) => '-'.repeat(w)).join('+-'));

    for (const r of results) {
        console.log(
            [
                padRight(r.label, widths[0]),
                padRight(r.type, widths[1]),
                padLeft(String(r.activations7d), widths[2]),
                padLeft(String(r.miss7d), widths[3]),
                padLeft(String(r.miss30d), widths[4]),
                padLeft(String(r.missTotal), widths[5]),
                padRight(r.trend, widths[6]),
                padRight(r.promotionRecommendation, widths[7]),
            ].join('| '),
        );
    }

    const candidatesToPromote = results.filter((r) => r.promotionRecommendation.startsWith('PROMUOVI'));
    const candidatesToConsider = results.filter((r) => r.promotionRecommendation.startsWith('valuta'));

    console.log('\n--- Sintesi ---');
    console.log(`Candidate forti per promozione blocking (miss reali ricorrenti): ${candidatesToPromote.length}`);
    candidatesToPromote.forEach((r) => console.log(`  - ${r.label}: miss ${r.miss7d}/7d, act ${r.activations7d}/7d`));
    console.log(`Candidate da valutare (miss sostenuti su 30d): ${candidatesToConsider.length}`);
    candidatesToConsider.forEach((r) => console.log(`  - ${r.label}: miss ${r.miss30d}/30d`));

    const stale = results.filter((r) => r.activationsTotal === 0);
    if (stale.length > 0) {
        console.log(`\nRegole senza activations registrate: ${stale.length} (verifica che il log si scriva davvero)`);
        stale.forEach((r) => console.log(`  - ${r.label}`));
    }

    console.log('\nOK — audit informativo, non blocca chiusura.');
}

run();
