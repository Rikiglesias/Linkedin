import { describe, it, expect, beforeAll } from 'vitest';
import { resolveFollowUpCadence } from '../workers/followUpWorker';
import { config } from '../config';

beforeAll(() => {
    config.followUpDelayDays = 5;
    config.followUpQuestionsDelayDays = 3;
    config.followUpNegativeDelayDays = 30;
    config.followUpNotInterestedDelayDays = 60;
});

describe('resolveFollowUpCadence — extreme inputs', () => {
    it('follow_up_count = 100 → delay molto lungo', () => {
        const cadence = resolveFollowUpCadence(
            {
                id: 500,
                messaged_at: '2024-01-01T00:00:00Z',
                follow_up_sent_at: '2024-06-01T00:00:00Z',
                follow_up_count: 100,
            },
            null,
        );
        expect(cadence.requiredDelayDays).toBeGreaterThan(100);
    });

    it('leadId = 0 → funziona', () => {
        const cadence = resolveFollowUpCadence(
            { id: 0, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        expect(cadence.requiredDelayDays).toBeGreaterThanOrEqual(1);
    });

    it('leadId negativo → funziona', () => {
        const cadence = resolveFollowUpCadence(
            { id: -1, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        expect(cadence.requiredDelayDays).toBeGreaterThanOrEqual(1);
    });

    it('messaged_at futuro → referenceDaysSince negativo o 0', () => {
        const future = new Date(Date.now() + 30 * 86400000).toISOString();
        const cadence = resolveFollowUpCadence(
            { id: 600, messaged_at: future, follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        expect(cadence.referenceDaysSince).toBeLessThanOrEqual(0);
    });

    it('intent vuoto → intent_default', () => {
        const cadence = resolveFollowUpCadence(
            { id: 700, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            { intent: '', subIntent: '', confidence: 0, entities: [] },
        );
        expect(cadence.reason).toBe('intent_default');
    });

    it('subIntent PRICE_INQUIRY → reason sub_intent_price_inquiry', () => {
        const cadence = resolveFollowUpCadence(
            { id: 800, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEUTRAL', subIntent: 'PRICE_INQUIRY', confidence: 0.9, entities: [] },
        );
        expect(cadence.reason).toBe('sub_intent_price_inquiry');
    });

    it('subIntent REFERRAL → reason sub_intent_referral', () => {
        const cadence = resolveFollowUpCadence(
            { id: 801, messaged_at: '2025-01-01T00:00:00Z', follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEUTRAL', subIntent: 'REFERRAL', confidence: 0.85, entities: [] },
        );
        expect(cadence.reason).toBe('sub_intent_referral');
    });
});
