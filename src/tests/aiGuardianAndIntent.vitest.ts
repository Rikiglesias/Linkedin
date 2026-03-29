import { describe, it, expect, beforeAll } from 'vitest';
import {
    heuristics,
    tryExtractJsonBlock,
    parseAiDecision,
    enforceHeuristicFloor,
    clampPauseMinutes,
} from '../ai/guardian';
import { clampConfidence, normalizeIntent, normalizeSubIntent, buildFallbackDraft } from '../ai/intentResolver';
import type { ScheduleResult } from '../core/scheduler';
import type { RiskSnapshot } from '../types/domain';

beforeAll(async () => {
    const { config } = await import('../config');
    config.aiGuardianPauseMinutes = 120;
    config.pendingRatioWarn = 0.5;
});

// ─── Helper: minimal ScheduleResult builder ──────────────────────────────────

function makeSchedule(
    overrides: Partial<ScheduleResult> & {
        riskAction?: RiskSnapshot['action'];
        pendingRatio?: number;
        errorRate?: number;
        listOverrides?: Partial<ScheduleResult['listBreakdown'][0]>[];
    } = {},
): ScheduleResult {
    const { riskAction, pendingRatio, errorRate, listOverrides, ...rest } = overrides;
    return {
        localDate: '2026-03-21',
        riskSnapshot: {
            score: 0,
            action: riskAction ?? 'NORMAL',
            pendingRatio: pendingRatio ?? 0.1,
            errorRate: errorRate ?? 0,
            selectorFailureRate: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
            factors: [],
        } as RiskSnapshot,
        inviteBudget: 10,
        messageBudget: 5,
        weeklyInvitesSent: 20,
        weeklyInviteLimitEffective: 50,
        weeklyInvitesRemaining: 30,
        queuedInviteJobs: 0,
        queuedCheckJobs: 0,
        queuedMessageJobs: 0,
        listBreakdown: listOverrides
            ? listOverrides.map((lo, i) => ({
                  listName: `list_${i}`,
                  inviteBudget: 5,
                  messageBudget: 3,
                  queuedInviteJobs: 0,
                  queuedCheckJobs: 0,
                  queuedMessageJobs: 0,
                  adaptiveFactor: 1,
                  adaptiveReasons: [],
                  pendingRatio: 0,
                  blockedRatio: 0,
                  maxScheduledDelaySec: 0,
                  ...lo,
              }))
            : [
                  {
                      listName: 'default',
                      inviteBudget: 10,
                      messageBudget: 5,
                      queuedInviteJobs: 0,
                      queuedCheckJobs: 0,
                      queuedMessageJobs: 0,
                      adaptiveFactor: 1,
                      adaptiveReasons: [],
                      pendingRatio: 0,
                      blockedRatio: 0,
                      maxScheduledDelaySec: 0,
                  },
              ],
        dryRun: false,
        ...rest,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN — heuristics
// ═══════════════════════════════════════════════════════════════════════════════

describe('guardian — heuristics', () => {
    it('NORMAL + no issue → severity normal', () => {
        const d = heuristics(makeSchedule());
        expect(d.severity).toBe('normal');
        expect(d.source).toBe('heuristic');
    });

    it('STOP → severity critical', () => {
        const d = heuristics(makeSchedule({ riskAction: 'STOP' }));
        expect(d.severity).toBe('critical');
        expect(d.pauseMinutes).toBeGreaterThan(0);
    });

    it('WARN → severity watch', () => {
        const d = heuristics(makeSchedule({ riskAction: 'WARN' }));
        expect(d.severity).toBe('watch');
    });

    it('LOW_ACTIVITY → severity watch', () => {
        const d = heuristics(makeSchedule({ riskAction: 'LOW_ACTIVITY' }));
        expect(d.severity).toBe('watch');
    });

    it('pendingRatio >= pendingRatioWarn → watch', () => {
        const d = heuristics(makeSchedule({ pendingRatio: 0.55 }));
        expect(d.severity).toBe('watch');
    });

    it('errorRate >= 0.2 → watch', () => {
        const d = heuristics(makeSchedule({ errorRate: 0.25 }));
        expect(d.severity).toBe('watch');
    });

    it('lista con pendingRatio >= 0.78 → critical', () => {
        const d = heuristics(makeSchedule({ listOverrides: [{ pendingRatio: 0.8 }] }));
        expect(d.severity).toBe('critical');
    });

    it('lista con blockedRatio >= 0.35 → critical', () => {
        const d = heuristics(makeSchedule({ listOverrides: [{ blockedRatio: 0.4 }] }));
        expect(d.severity).toBe('critical');
    });

    it('lista a 0.77 pendingRatio → NON critical', () => {
        const d = heuristics(makeSchedule({ listOverrides: [{ pendingRatio: 0.77 }] }));
        expect(d.severity).not.toBe('critical');
    });

    it('recommendations sempre presenti', () => {
        const normal = heuristics(makeSchedule());
        const critical = heuristics(makeSchedule({ riskAction: 'STOP' }));
        expect(normal.recommendations.length).toBeGreaterThan(0);
        expect(critical.recommendations.length).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN — tryExtractJsonBlock
// ═══════════════════════════════════════════════════════════════════════════════

describe('guardian — tryExtractJsonBlock', () => {
    it('JSON semplice', () => {
        expect(tryExtractJsonBlock('{"a":1}')).toBe('{"a":1}');
    });

    it('JSON con testo attorno', () => {
        expect(tryExtractJsonBlock('Here is the result: {"severity":"normal"} done.')).toBe('{"severity":"normal"}');
    });

    it('JSON in code fence', () => {
        const raw = '```json\n{"severity":"watch"}\n```';
        expect(tryExtractJsonBlock(raw)).toBe('{"severity":"watch"}');
    });

    it('JSON nested', () => {
        const raw = '{"a":{"b":1},"c":2}';
        expect(tryExtractJsonBlock(raw)).toBe(raw);
    });

    it('nessun JSON → null', () => {
        expect(tryExtractJsonBlock('no json here')).toBeNull();
    });

    it('JSON incompleto → null', () => {
        expect(tryExtractJsonBlock('{"a":1')).toBeNull();
    });

    it('stringa vuota → null', () => {
        expect(tryExtractJsonBlock('')).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN — parseAiDecision
// ═══════════════════════════════════════════════════════════════════════════════

describe('guardian — parseAiDecision', () => {
    it('JSON valido con tutti i campi', () => {
        const raw = JSON.stringify({
            severity: 'watch',
            summary: 'Rischio medio',
            recommendations: ['Ridurre inviti', 'Monitorare'],
            pauseMinutes: 0,
        });
        const result = parseAiDecision(raw);
        expect(result).not.toBeNull();
        if (!result) return;
        expect(result.severity).toBe('watch');
        expect(result.recommendations).toHaveLength(2);
    });

    it('severity sconosciuta → default watch', () => {
        const raw = JSON.stringify({ severity: 'extreme', summary: 'Test' });
        const result = parseAiDecision(raw);
        if (!result) {
            expect(result).not.toBeNull();
            return;
        }
        expect(result.severity).toBe('watch');
    });

    it('pauseMinutes > 24h → clamp a 1440', () => {
        const raw = JSON.stringify({ severity: 'critical', pauseMinutes: 9999 });
        const result = parseAiDecision(raw);
        if (!result) {
            expect(result).not.toBeNull();
            return;
        }
        expect(result.pauseMinutes).toBe(1440);
    });

    it('pauseMinutes negativo → 0', () => {
        const raw = JSON.stringify({ severity: 'normal', pauseMinutes: -10 });
        const result = parseAiDecision(raw);
        if (!result) {
            expect(result).not.toBeNull();
            return;
        }
        expect(result.pauseMinutes).toBe(0);
    });

    it('recommendations troncate a 5', () => {
        const raw = JSON.stringify({
            severity: 'watch',
            recommendations: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        });
        const result = parseAiDecision(raw);
        if (!result) {
            expect(result).not.toBeNull();
            return;
        }
        expect(result.recommendations.length).toBeLessThanOrEqual(5);
    });

    it('nessun JSON → null', () => {
        expect(parseAiDecision('just text')).toBeNull();
    });

    it('JSON malformato → null', () => {
        expect(parseAiDecision('{broken json')).toBeNull();
    });

    it('summary vuoto → fallback default', () => {
        const raw = JSON.stringify({ severity: 'normal', summary: '' });
        const result = parseAiDecision(raw);
        if (!result) {
            expect(result).not.toBeNull();
            return;
        }
        expect(result.summary.length).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN — enforceHeuristicFloor
// ═══════════════════════════════════════════════════════════════════════════════

describe('guardian — enforceHeuristicFloor', () => {
    const base = { summary: 'test', recommendations: [], pauseMinutes: 0 };

    it('AI normal + heuristic watch → forced to watch', () => {
        const result = enforceHeuristicFloor({ ...base, severity: 'normal' }, 'watch');
        expect(result.severity).toBe('watch');
    });

    it('AI critical + heuristic normal → stays critical', () => {
        const result = enforceHeuristicFloor({ ...base, severity: 'critical' }, 'normal');
        expect(result.severity).toBe('critical');
    });

    it('AI watch + heuristic watch → stays watch', () => {
        const result = enforceHeuristicFloor({ ...base, severity: 'watch' }, 'watch');
        expect(result.severity).toBe('watch');
    });

    it('AI normal + heuristic normal → stays normal', () => {
        const result = enforceHeuristicFloor({ ...base, severity: 'normal' }, 'normal');
        expect(result.severity).toBe('normal');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN — clampPauseMinutes
// ═══════════════════════════════════════════════════════════════════════════════

describe('guardian — clampPauseMinutes', () => {
    it('valore valido → floor', () => expect(clampPauseMinutes(60.9)).toBe(60));
    it('negativo → 0', () => expect(clampPauseMinutes(-10)).toBe(0));
    it('zero → 0', () => expect(clampPauseMinutes(0)).toBe(0));
    it('> 24h → 1440', () => expect(clampPauseMinutes(2000)).toBe(1440));
    it('NaN → 0', () => expect(clampPauseMinutes(NaN)).toBe(0));
    it('Infinity → 0', () => expect(clampPauseMinutes(Infinity)).toBe(0));
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT RESOLVER — normalizeIntent
// ═══════════════════════════════════════════════════════════════════════════════

describe('intentResolver — normalizeIntent', () => {
    it('stringa valida uppercase → invariata', () => {
        expect(normalizeIntent('POSITIVE')).toBe('POSITIVE');
    });

    it('lowercase → normalizzato', () => {
        expect(normalizeIntent('negative')).toBe('NEGATIVE');
    });

    it('mixed case → normalizzato', () => {
        expect(normalizeIntent('Questions')).toBe('QUESTIONS');
    });

    it('valore sconosciuto → UNKNOWN', () => {
        expect(normalizeIntent('HAPPY')).toBe('UNKNOWN');
    });

    it('null → UNKNOWN', () => {
        expect(normalizeIntent(null)).toBe('UNKNOWN');
    });

    it('undefined → UNKNOWN', () => {
        expect(normalizeIntent(undefined)).toBe('UNKNOWN');
    });

    it('numero → UNKNOWN', () => {
        expect(normalizeIntent(42)).toBe('UNKNOWN');
    });

    it('NOT_INTERESTED valido', () => {
        expect(normalizeIntent('not_interested')).toBe('NOT_INTERESTED');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT RESOLVER — normalizeSubIntent
// ═══════════════════════════════════════════════════════════════════════════════

describe('intentResolver — normalizeSubIntent', () => {
    it('CALL_REQUESTED valido', () => {
        expect(normalizeSubIntent('CALL_REQUESTED')).toBe('CALL_REQUESTED');
    });

    it('lowercase → normalizzato', () => {
        expect(normalizeSubIntent('price_inquiry')).toBe('PRICE_INQUIRY');
    });

    it('valore sconosciuto → NONE', () => {
        expect(normalizeSubIntent('MAGIC')).toBe('NONE');
    });

    it('null → NONE', () => {
        expect(normalizeSubIntent(null)).toBe('NONE');
    });

    it('tutti i valori validi', () => {
        const valid = [
            'CALL_REQUESTED',
            'PRICE_INQUIRY',
            'OBJECTION_HANDLING',
            'COMPETITOR_MENTION',
            'REFERRAL',
            'NONE',
        ];
        for (const v of valid) {
            expect(normalizeSubIntent(v)).toBe(v);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT RESOLVER — clampConfidence
// ═══════════════════════════════════════════════════════════════════════════════

describe('intentResolver — clampConfidence', () => {
    it('numero nel range → invariato', () => {
        expect(clampConfidence(0.8, 0.5)).toBe(0.8);
    });

    it('sopra 1 → clamp a 1', () => {
        expect(clampConfidence(1.5, 0.5)).toBe(1);
    });

    it('sotto 0 → clamp a 0', () => {
        expect(clampConfidence(-0.3, 0.5)).toBe(0);
    });

    it('stringa numerica → parsata', () => {
        expect(clampConfidence('0.75', 0.5)).toBe(0.75);
    });

    it('null → fallback', () => {
        expect(clampConfidence(null, 0.6)).toBe(0.6);
    });

    it('undefined → fallback', () => {
        expect(clampConfidence(undefined, 0.7)).toBe(0.7);
    });

    it('stringa non numerica → fallback', () => {
        expect(clampConfidence('abc', 0.4)).toBe(0.4);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT RESOLVER — buildFallbackDraft
// ═══════════════════════════════════════════════════════════════════════════════

describe('intentResolver — buildFallbackDraft', () => {
    it('NOT_INTERESTED → chiusura elegante', () => {
        const draft = buildFallbackDraft('NOT_INTERESTED', 'Non mi interessa');
        expect(draft).toContain('trasparenza');
        expect(draft).toContain('non ti disturbo');
    });

    it('NEGATIVE → stessa chiusura elegante', () => {
        const draft = buildFallbackDraft('NEGATIVE', 'Non mi interessa');
        expect(draft).toContain('trasparenza');
    });

    it('QUESTIONS → include snippet del testo', () => {
        const draft = buildFallbackDraft('QUESTIONS', 'Quanto costa il servizio?');
        expect(draft).toContain('Quanto costa il servizio');
    });

    it('POSITIVE → prossimo passo pratico', () => {
        const draft = buildFallbackDraft('POSITIVE', 'Sì, mi interessa');
        expect(draft).toContain('volentieri');
    });

    it('NEUTRAL → draft generico', () => {
        const draft = buildFallbackDraft('NEUTRAL', 'Ok grazie');
        expect(draft.length).toBeGreaterThan(20);
    });

    it('UNKNOWN → draft generico', () => {
        const draft = buildFallbackDraft('UNKNOWN', 'Hmm');
        expect(draft.length).toBeGreaterThan(20);
    });

    it('testo lungo → snippet troncato a 110 char', () => {
        const longText = 'a'.repeat(200);
        const draft = buildFallbackDraft('QUESTIONS', longText);
        // Lo snippet interno non deve contenere tutto il testo
        expect(draft.length).toBeLessThan(300);
    });
});
