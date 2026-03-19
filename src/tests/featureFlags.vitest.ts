import { describe, it, expect } from 'vitest';
import { resolveFollowUpCadence } from '../workers/followUpWorker';

describe('followUpWorker — resolveFollowUpCadence edge cases', () => {
    it('follow_up_count negativo → trattato come 0', () => {
        const cadence = resolveFollowUpCadence(
            { id: 200, messaged_at: new Date(Date.now() - 30 * 86400000).toISOString(), follow_up_sent_at: null, follow_up_count: -5 },
            null,
        );
        expect(cadence.requiredDelayDays).toBeGreaterThanOrEqual(1);
    });

    it('messaged_at null → referenceDaysSince = 0', () => {
        const cadence = resolveFollowUpCadence(
            { id: 201, messaged_at: null, follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        expect(cadence.referenceDaysSince).toBe(0);
    });

    it('intent QUESTIONS → baseDelay più breve di default', () => {
        const questions = resolveFollowUpCadence(
            { id: 202, messaged_at: new Date(Date.now() - 30 * 86400000).toISOString(), follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'QUESTIONS', subIntent: 'NONE', confidence: 0.8, entities: [] },
        );
        const defaultCadence = resolveFollowUpCadence(
            { id: 203, messaged_at: new Date(Date.now() - 30 * 86400000).toISOString(), follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        expect(questions.baseDelayDays).toBeLessThanOrEqual(defaultCadence.baseDelayDays);
    });

    it('intent NEGATIVE → baseDelay più lungo', () => {
        const negative = resolveFollowUpCadence(
            { id: 204, messaged_at: new Date(Date.now() - 90 * 86400000).toISOString(), follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEGATIVE', subIntent: 'NONE', confidence: 0.9, entities: [] },
        );
        expect(negative.baseDelayDays).toBeGreaterThanOrEqual(20);
    });

    it('subIntent OBJECTION_HANDLING → delay intermedio tra questions e negative', () => {
        const objection = resolveFollowUpCadence(
            { id: 205, messaged_at: new Date(Date.now() - 30 * 86400000).toISOString(), follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEGATIVE', subIntent: 'OBJECTION_HANDLING', confidence: 0.85, entities: [] },
        );
        expect(objection.reason).toBe('intent_negative_objection');
    });

    it('subIntent CALL_REQUESTED → delay corto', () => {
        const call = resolveFollowUpCadence(
            { id: 206, messaged_at: new Date(Date.now() - 10 * 86400000).toISOString(), follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEUTRAL', subIntent: 'CALL_REQUESTED', confidence: 0.9, entities: [] },
        );
        expect(call.reason).toContain('sub_intent');
    });

    it('follow_up_count alto → requiredDelayDays cresce (M29 lineare)', () => {
        const fc0 = resolveFollowUpCadence(
            { id: 300, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        const fc3 = resolveFollowUpCadence(
            { id: 300, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: '2025-01-20T00:00:00Z', follow_up_count: 3 },
            null,
        );
        expect(fc3.requiredDelayDays).toBeGreaterThan(fc0.requiredDelayDays);
    });
});
