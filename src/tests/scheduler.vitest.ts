import { describe, it, expect, beforeAll } from 'vitest';
import {
    workflowToJobTypes,
    buildInviteKey,
    buildMessageKey,
    buildCheckKey,
    computeListBudget,
    computeAccountBudgetShares,
    toNonNegativeInt,
    clamp01,
    applyAdaptiveFactor,
    clampInt,
    parseSsiScore,
    capFromSsi,
    resolveCapPair,
    applyHourIntensityToBudget,
    evaluateAdaptiveBudgetContext,
    createNoBurstPlanner,
} from '../core/scheduler';

beforeAll(async () => {
    const { config } = await import('../config');
    // Assicura che le config necessarie per evaluateAdaptiveBudgetContext siano settate
    config.adaptiveCapsEnabled = true;
    config.adaptiveCapsPendingStop = 0.65;
    config.adaptiveCapsPendingWarn = 0.45;
    config.adaptiveCapsBlockedWarn = 0.15;
    config.adaptiveCapsMinFactor = 0.2;
    config.adaptiveCapsWarnFactor = 0.7;
    config.lowActivityBudgetFactor = 0.5;
    // NoBurst config
    config.noBurstMinDelaySec = 30;
    config.noBurstMaxDelaySec = 90;
    config.noBurstLongBreakEvery = 5;
    config.noBurstLongBreakMinSec = 120;
    config.noBurstLongBreakMaxSec = 300;
});

// ─── workflowToJobTypes ──────────────────────────────────────────────────────

describe('workflowToJobTypes', () => {
    it('all → include tutti i tipi principali', () => {
        const types = workflowToJobTypes('all');
        expect(types).toContain('INVITE');
        expect(types).toContain('ACCEPTANCE_CHECK');
        expect(types).toContain('MESSAGE');
        expect(types).toContain('HYGIENE');
        expect(types).toContain('INTERACTION');
        expect(types.length).toBeGreaterThanOrEqual(5);
    });

    it('invite → solo INVITE', () => {
        expect(workflowToJobTypes('invite')).toEqual(['INVITE']);
    });

    it('check → ACCEPTANCE_CHECK + HYGIENE', () => {
        const types = workflowToJobTypes('check');
        expect(types).toContain('ACCEPTANCE_CHECK');
        expect(types).toContain('HYGIENE');
    });

    it('warmup → array vuoto', () => {
        expect(workflowToJobTypes('warmup')).toEqual([]);
    });

    it('message → MESSAGE + HYGIENE', () => {
        const types = workflowToJobTypes('message');
        expect(types).toContain('MESSAGE');
        expect(types).toContain('HYGIENE');
    });
});

// ─── buildKeys ───────────────────────────────────────────────────────────────

describe('buildKeys — idempotency key generation', () => {
    it('buildInviteKey formato corretto', () => {
        expect(buildInviteKey(42, '2026-03-21')).toBe('invite:42:2026-03-21');
    });

    it('buildMessageKey formato corretto', () => {
        expect(buildMessageKey(99, '2026-03-20')).toBe('message:99:2026-03-20');
    });

    it('buildCheckKey formato corretto', () => {
        expect(buildCheckKey(7, '2026-01-01')).toBe('check:7:2026-01-01');
    });

    it('leadId 0 e date vuota → ancora valido', () => {
        expect(buildInviteKey(0, '')).toBe('invite:0:');
    });
});

// ─── computeListBudget ───────────────────────────────────────────────────────

describe('computeListBudget', () => {
    it('senza listCap → usa globalRemaining', () => {
        expect(computeListBudget(10, null, 0)).toBe(10);
    });

    it('listCap limita il budget', () => {
        expect(computeListBudget(100, 5, 0)).toBe(5);
    });

    it('alreadyConsumed riduce listCap', () => {
        expect(computeListBudget(100, 10, 7)).toBe(3);
    });

    it('alreadyConsumed >= listCap → 0', () => {
        expect(computeListBudget(100, 10, 10)).toBe(0);
        expect(computeListBudget(100, 10, 15)).toBe(0);
    });

    it('globalRemaining 0 → 0 anche con listCap alto', () => {
        expect(computeListBudget(0, 100, 0)).toBe(0);
    });

    it('globalRemaining negativo → 0', () => {
        expect(computeListBudget(-5, null, 0)).toBe(0);
    });

    it('min tra globalRemaining e listRemaining', () => {
        // globalRemaining=3, listCap=10, consumed=0 → min(3, 10) = 3
        expect(computeListBudget(3, 10, 0)).toBe(3);
    });
});

// ─── computeAccountBudgetShares ──────────────────────────────────────────────

describe('computeAccountBudgetShares', () => {
    const makeAccount = (id: string, invW: number, msgW: number) => ({
        id,
        sessionDir: `/tmp/${id}`,
        inviteWeight: invW,
        messageWeight: msgW,
        warmupEnabled: false,
        warmupMaxDays: 30,
        warmupMinActions: 5,
    });

    it('singolo account → prende tutto il budget', () => {
        const accounts = [makeAccount('a1', 1, 1)] as ReturnType<
            typeof import('../accountManager').getRuntimeAccountProfiles
        >;
        const shares = computeAccountBudgetShares(accounts, 10, 'invite');
        expect(shares.get('a1')).toBe(10);
    });

    it('due account peso uguale → split equo', () => {
        const accounts = [makeAccount('a1', 1, 1), makeAccount('a2', 1, 1)] as ReturnType<
            typeof import('../accountManager').getRuntimeAccountProfiles
        >;
        const shares = computeAccountBudgetShares(accounts, 10, 'invite');
        expect(shares.get('a1')).toBe(5);
        expect(shares.get('a2')).toBe(5);
    });

    it('due account peso 3:1 → distribuzione proporzionale', () => {
        const accounts = [makeAccount('a1', 3, 1), makeAccount('a2', 1, 1)] as ReturnType<
            typeof import('../accountManager').getRuntimeAccountProfiles
        >;
        const shares = computeAccountBudgetShares(accounts, 12, 'invite');
        // 3/4 * 12 = 9, 1/4 * 12 = 3
        expect(shares.get('a1')).toBe(9);
        expect(shares.get('a2')).toBe(3);
    });

    it('budget 0 → tutti zero', () => {
        const accounts = [makeAccount('a1', 1, 1)] as ReturnType<
            typeof import('../accountManager').getRuntimeAccountProfiles
        >;
        const shares = computeAccountBudgetShares(accounts, 0, 'invite');
        expect(shares.get('a1')).toBe(0);
    });

    it('budget negativo → tutti zero', () => {
        const accounts = [makeAccount('a1', 1, 1)] as ReturnType<
            typeof import('../accountManager').getRuntimeAccountProfiles
        >;
        const shares = computeAccountBudgetShares(accounts, -5, 'invite');
        expect(shares.get('a1')).toBe(0);
    });

    it('nessun account → default prende tutto', () => {
        const shares = computeAccountBudgetShares(
            [] as ReturnType<typeof import('../accountManager').getRuntimeAccountProfiles>,
            10,
            'invite',
        );
        expect(shares.get('default')).toBe(10);
    });

    it('somma shares === budget totale', () => {
        const accounts = [makeAccount('a1', 2, 1), makeAccount('a2', 3, 1), makeAccount('a3', 1, 1)] as ReturnType<
            typeof import('../accountManager').getRuntimeAccountProfiles
        >;
        const shares = computeAccountBudgetShares(accounts, 17, 'invite');
        const total = Array.from(shares.values()).reduce((s, v) => s + v, 0);
        expect(total).toBe(17);
    });

    it('channel message usa messageWeight', () => {
        const accounts = [makeAccount('a1', 1, 5), makeAccount('a2', 1, 1)] as ReturnType<
            typeof import('../accountManager').getRuntimeAccountProfiles
        >;
        const shares = computeAccountBudgetShares(accounts, 12, 'message');
        // a1 ha messageWeight 5, a2 ha 1 → 5/6 * 12 = 10, 1/6 * 12 = 2
        expect(shares.get('a1')).toBe(10);
        expect(shares.get('a2')).toBe(2);
    });
});

// ─── utility: toNonNegativeInt, clamp01, clampInt ────────────────────────────

describe('utility — toNonNegativeInt', () => {
    it('positivo → floor', () => expect(toNonNegativeInt(3.7)).toBe(3));
    it('negativo → 0', () => expect(toNonNegativeInt(-5)).toBe(0));
    it('zero → 0', () => expect(toNonNegativeInt(0)).toBe(0));
    it('NaN → NaN (non gestito)', () => expect(toNonNegativeInt(NaN)).toBeNaN());
});

describe('utility — clamp01', () => {
    it('nel range → invariato', () => expect(clamp01(0.5)).toBe(0.5));
    it('sopra 1 → 1', () => expect(clamp01(1.5)).toBe(1));
    it('sotto 0 → 0', () => expect(clamp01(-0.3)).toBe(0));
    it('NaN → NaN (non gestito)', () => expect(clamp01(NaN)).toBeNaN());
});

describe('utility — clampInt', () => {
    it('nel range → arrotondato', () => expect(clampInt(5.4, 0, 10)).toBe(5));
    it('sotto min → min', () => expect(clampInt(-3, 0, 10)).toBe(0));
    it('sopra max → max', () => expect(clampInt(15, 0, 10)).toBe(10));
    it('arrotondamento .5 → round up', () => expect(clampInt(5.5, 0, 10)).toBe(6));
});

// ─── applyAdaptiveFactor ─────────────────────────────────────────────────────

describe('applyAdaptiveFactor', () => {
    it('factor 1 → budget invariato', () => {
        expect(applyAdaptiveFactor(10, 1)).toBe(10);
    });

    it('factor 0.5 → metà', () => {
        expect(applyAdaptiveFactor(10, 0.5)).toBe(5);
    });

    it('factor 0 → 0', () => {
        expect(applyAdaptiveFactor(10, 0)).toBe(0);
    });

    it('budget 0 → 0 anche con factor > 0', () => {
        expect(applyAdaptiveFactor(0, 0.8)).toBe(0);
    });

    it('factor molto piccolo → almeno 1 (se budget > 0)', () => {
        expect(applyAdaptiveFactor(10, 0.01)).toBe(1);
    });

    it('budget negativo → 0', () => {
        expect(applyAdaptiveFactor(-5, 1)).toBe(0);
    });

    it('factor > 1 → non supera rawBudget', () => {
        expect(applyAdaptiveFactor(10, 2)).toBe(10);
    });
});

// ─── parseSsiScore ───────────────────────────────────────────────────────────

describe('parseSsiScore', () => {
    it('null → fallback', () => {
        expect(parseSsiScore(null, 50)).toBe(50);
    });

    it('stringa numerica diretta', () => {
        expect(parseSsiScore('72', 50)).toBe(72);
    });

    it('JSON con score', () => {
        expect(parseSsiScore('{"score": 85}', 50)).toBe(85);
    });

    it('JSON con ssi', () => {
        expect(parseSsiScore('{"ssi": 60}', 50)).toBe(60);
    });

    it('valore sopra 100 → clamp a 100', () => {
        expect(parseSsiScore('150', 50)).toBe(100);
    });

    it('valore sotto 0 → clamp a 0', () => {
        expect(parseSsiScore('-10', 50)).toBe(0);
    });

    it('JSON malformato → fallback', () => {
        expect(parseSsiScore('{invalid}', 50)).toBe(50);
    });

    it('stringa non numerica → fallback', () => {
        expect(parseSsiScore('hello', 50)).toBe(50);
    });

    it('stringa vuota → fallback', () => {
        expect(parseSsiScore('', 50)).toBe(50);
    });
});

// ─── capFromSsi ──────────────────────────────────────────────────────────────

describe('capFromSsi', () => {
    it('score 0 → minCap', () => {
        expect(capFromSsi(0, 5, 25)).toBe(5);
    });

    it('score 100 → maxCap', () => {
        expect(capFromSsi(100, 5, 25)).toBe(25);
    });

    it('score 50 → metà del range', () => {
        expect(capFromSsi(50, 10, 30)).toBe(20);
    });

    it('minCap > maxCap → swap automatico', () => {
        // low = min(25, 5) = 5, high = max(25, 5) = 25
        expect(capFromSsi(0, 25, 5)).toBe(5);
        expect(capFromSsi(100, 25, 5)).toBe(25);
    });

    it('score negativo → clamp a 0 → minCap', () => {
        expect(capFromSsi(-50, 5, 25)).toBe(5);
    });

    it('score > 100 → clamp a 100 → maxCap', () => {
        expect(capFromSsi(200, 5, 25)).toBe(25);
    });
});

// ─── resolveCapPair ──────────────────────────────────────────────────────────

describe('resolveCapPair', () => {
    it('dynamicCap > staticHard → hard = staticHard', () => {
        const { soft, hard } = resolveCapPair(10, 25, 30);
        expect(hard).toBe(25);
        expect(soft).toBe(10);
    });

    it('dynamicCap < staticHard → hard = dynamicCap', () => {
        const { soft, hard } = resolveCapPair(10, 25, 15);
        expect(hard).toBe(15);
        expect(soft).toBe(10);
    });

    it('soft > hard → soft viene troncato a hard', () => {
        const { soft, hard } = resolveCapPair(20, 25, 12);
        expect(hard).toBe(12);
        expect(soft).toBe(12); // min(20, 12)
    });

    it('valori zero → almeno 1', () => {
        const { soft, hard } = resolveCapPair(0, 0, 0);
        expect(soft).toBeGreaterThanOrEqual(1);
        expect(hard).toBeGreaterThanOrEqual(1);
    });
});

// ─── applyHourIntensityToBudget ──────────────────────────────────────────────

describe('applyHourIntensityToBudget', () => {
    it('intensity 1.0 → budget invariato', () => {
        expect(applyHourIntensityToBudget(10, 1.0)).toBe(10);
    });

    it('intensity 0.5 → dimezzato', () => {
        expect(applyHourIntensityToBudget(10, 0.5)).toBe(5);
    });

    it('intensity 0 → 0', () => {
        expect(applyHourIntensityToBudget(10, 0)).toBe(0);
    });

    it('budget 0 → 0', () => {
        expect(applyHourIntensityToBudget(0, 0.5)).toBe(0);
    });

    it('budget negativo → 0', () => {
        expect(applyHourIntensityToBudget(-3, 0.5)).toBe(0);
    });

    it('intensity molto piccola → almeno 1 (se budget > 0)', () => {
        expect(applyHourIntensityToBudget(10, 0.01)).toBe(1);
    });

    it('intensity > 1 → non supera budget originale', () => {
        // intensity >= 0.999 → budget invariato
        expect(applyHourIntensityToBudget(10, 1.5)).toBe(10);
    });
});

// ─── evaluateAdaptiveBudgetContext ───────────────────────────────────────────

describe('evaluateAdaptiveBudgetContext', () => {
    it('STOP → factor 0', () => {
        const ctx = evaluateAdaptiveBudgetContext({}, 'STOP');
        expect(ctx.factor).toBe(0);
        expect(ctx.reasons).toContain('global_risk_stop');
    });

    it('NORMAL senza pending → factor 1', () => {
        const ctx = evaluateAdaptiveBudgetContext({ ACCEPTED: 50, INVITED: 10 }, 'NORMAL');
        expect(ctx.factor).toBe(1);
        expect(ctx.reasons).toHaveLength(0);
    });

    it('LOW_ACTIVITY → factor ridotto', () => {
        const ctx = evaluateAdaptiveBudgetContext({}, 'LOW_ACTIVITY');
        expect(ctx.factor).toBeLessThan(1);
        expect(ctx.reasons).toContain('global_risk_low_activity');
    });

    it('WARN → factor ridotto', () => {
        const ctx = evaluateAdaptiveBudgetContext({}, 'WARN');
        expect(ctx.factor).toBeLessThan(1);
        expect(ctx.reasons).toContain('global_risk_warn');
    });

    it('pending ratio alto → list_pending_high + factor basso', () => {
        // 80 INVITED / (80 + 10 ACCEPTED) = 0.89 > 0.65 pendingStop
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 80, ACCEPTED: 10 }, 'NORMAL');
        expect(ctx.pendingRatio).toBeGreaterThan(0.65);
        expect(ctx.reasons).toContain('list_pending_high');
        expect(ctx.factor).toBeLessThanOrEqual(0.2);
    });

    it('pending ratio medio → list_pending_warn', () => {
        // 50 INVITED / (50 + 60 ACCEPTED) = 0.45 ≈ pendingWarn
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 55, ACCEPTED: 60 }, 'NORMAL');
        expect(ctx.pendingRatio).toBeGreaterThanOrEqual(0.45);
        expect(ctx.pendingRatio).toBeLessThan(0.65);
        expect(ctx.reasons).toContain('list_pending_warn');
        expect(ctx.factor).toBeLessThanOrEqual(0.5);
    });

    it('blocked ratio alto → list_blocked_warn', () => {
        // BLOCKED 20 / (10 INVITED + 20 ACCEPTED + 20 BLOCKED) = 0.4 > 0.15
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 10, ACCEPTED: 20, BLOCKED: 20 }, 'NORMAL');
        expect(ctx.blockedRatio).toBeGreaterThan(0.15);
        expect(ctx.reasons).toContain('list_blocked_warn');
        expect(ctx.factor).toBeLessThanOrEqual(0.6);
    });

    it('pending e blocked combinati → fattore minimo', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 90, BLOCKED: 30 }, 'WARN');
        expect(ctx.factor).toBeLessThanOrEqual(0.2);
        expect(ctx.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it('statusCounts vuoto + NORMAL → factor 1, ratio 0', () => {
        const ctx = evaluateAdaptiveBudgetContext({}, 'NORMAL');
        expect(ctx.factor).toBe(1);
        expect(ctx.pendingRatio).toBe(0);
        expect(ctx.blockedRatio).toBe(0);
    });
});

// ─── createNoBurstPlanner ────────────────────────────────────────────────────

describe('createNoBurstPlanner', () => {
    it('delay crescente monotono', () => {
        const planner = createNoBurstPlanner();
        const delays: number[] = [];
        for (let i = 0; i < 10; i++) {
            delays.push(planner.nextDelaySec());
        }
        for (let i = 1; i < delays.length; i++) {
            expect(delays[i]).toBeGreaterThan(delays[i - 1]);
        }
    });

    it('delay sempre >= 0', () => {
        const planner = createNoBurstPlanner();
        for (let i = 0; i < 20; i++) {
            expect(planner.nextDelaySec()).toBeGreaterThanOrEqual(0);
        }
    });

    it('long break al 5° job (longBreakEvery=5)', () => {
        const planner = createNoBurstPlanner();
        const delays: number[] = [];
        for (let i = 0; i < 6; i++) {
            delays.push(planner.nextDelaySec());
        }
        // Il 5° delay ha il long break aggiuntivo → gap tra 4° e 5° è maggiore
        const gap4to5 = delays[4] - delays[3];
        const gap3to4 = delays[3] - delays[2];
        expect(gap4to5).toBeGreaterThan(gap3to4);
    });
});
