import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestOpenAIText = vi.fn();
const getDecisionAccuracy = vi.fn();
const recordDecision = vi.fn();

vi.mock('../ai/openaiClient', () => ({
    requestOpenAIText,
}));

vi.mock('../ai/decisionFeedback', () => ({
    getDecisionAccuracy,
    recordDecision,
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn(async () => undefined),
    logWarn: vi.fn(async () => undefined),
}));

import { config } from '../config';
import { aiDecide } from '../ai/aiDecisionEngine';

describe('aiDecisionEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        config.aiPersonalizationEnabled = false;
        getDecisionAccuracy.mockResolvedValue([]);
        recordDecision.mockResolvedValue(undefined);
    });

    it('strict con AI disabilitata resta compatibile e non blocca il worker', async () => {
        const decision = await aiDecide({ point: 'pre_invite', strict: true });
        expect(decision.action).toBe('PROCEED');
        expect(decision.reason).toContain('ai_not_configured');
    });

    it('strict con risposta non parsabile su punto critico fa DEFER', async () => {
        config.aiPersonalizationEnabled = true;
        requestOpenAIText.mockResolvedValue('questa non è una risposta JSON');

        const decision = await aiDecide({ point: 'pre_message', strict: true });
        expect(decision.action).toBe('DEFER');
        expect(decision.reason).toContain('strict fallback');
    });

    it('strict con timeout su punto critico fa DEFER', async () => {
        vi.useFakeTimers();
        try {
            config.aiPersonalizationEnabled = true;
            requestOpenAIText.mockImplementation(() => new Promise(() => undefined));

            const decisionPromise = aiDecide({ point: 'pre_invite', strict: true });
            await vi.advanceTimersByTimeAsync(8_100);

            const decision = await decisionPromise;
            expect(decision.action).toBe('DEFER');
            expect(decision.reason).toContain('timeout');
        } finally {
            vi.useRealTimers();
        }
    });

    it('strict su inbox_reply con risposta invalida fa NOTIFY_HUMAN', async () => {
        config.aiPersonalizationEnabled = true;
        requestOpenAIText.mockResolvedValue('{ "action": "BOH", "reason": "x" }');

        const decision = await aiDecide({ point: 'inbox_reply', strict: true });
        expect(decision.action).toBe('NOTIFY_HUMAN');
        expect(decision.reason).toContain('invalid_action');
    });

    it('normalizza i nomi legacy della navigation strategy', async () => {
        config.aiPersonalizationEnabled = true;
        requestOpenAIText.mockResolvedValue(
            '{ "action": "PROCEED", "confidence": 0.9, "reason": "ok", "navigationStrategy": "organic_search" }',
        );

        const decision = await aiDecide({ point: 'navigation', strict: true });
        expect(decision.action).toBe('PROCEED');
        expect(decision.navigationStrategy).toBe('search_organic');
    });

    it('in modalita permissiva un errore AI mantiene il fallback storico', async () => {
        config.aiPersonalizationEnabled = true;
        requestOpenAIText.mockRejectedValue(new Error('boom'));

        const decision = await aiDecide({ point: 'pre_follow_up' });
        expect(decision.action).toBe('PROCEED');
        expect(decision.reason).toContain('ai_error');
    });
});
