import { describe, it, expect, beforeAll } from 'vitest';
import { resolveFollowUpCadence } from '../workers/followUpWorker';
import { config } from '../config';

beforeAll(() => {
    config.followUpDelayDays = 5;
    config.followUpQuestionsDelayDays = 3;
    config.followUpNegativeDelayDays = 30;
    config.followUpNotInterestedDelayDays = 60;
});

describe('resolveFollowUpCadence — comprehensive M29', () => {
    it('requiredDelayDays >= 1 per qualsiasi input', () => {
        const inputs = [
            { id: 1, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: 0 },
            { id: 2, messaged_at: null, follow_up_sent_at: null, follow_up_count: 0 },
            { id: 3, messaged_at: '2025-01-01', follow_up_sent_at: '2025-01-10', follow_up_count: 5 },
        ];
        for (const input of inputs) {
            expect(resolveFollowUpCadence(input, null).requiredDelayDays).toBeGreaterThanOrEqual(1);
        }
    });

    it('delay cresce linearmente con follow_up_count (M29)', () => {
        const delays = [0, 1, 2, 3, 4].map(count =>
            resolveFollowUpCadence({ id: 100, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: count }, null).requiredDelayDays,
        );
        for (let i = 1; i < delays.length; i++) {
            expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
        }
    });

    it('intent NEGATIVE ha baseDelay > intent default', () => {
        const neg = resolveFollowUpCadence(
            { id: 200, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: 0 },
            { intent: 'NEGATIVE', subIntent: 'NONE', confidence: 0.9, entities: [] },
        );
        const def = resolveFollowUpCadence(
            { id: 201, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        expect(neg.baseDelayDays).toBeGreaterThan(def.baseDelayDays);
    });

    it('referenceAt usa follow_up_sent_at se presente', () => {
        const c = resolveFollowUpCadence(
            { id: 300, messaged_at: '2025-01-01', follow_up_sent_at: '2025-01-15', follow_up_count: 1 },
            null,
        );
        expect(c.referenceAt).toBe('2025-01-15');
    });

    it('referenceAt usa messaged_at se follow_up_sent_at null', () => {
        const c = resolveFollowUpCadence(
            { id: 301, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: 0 },
            null,
        );
        expect(c.referenceAt).toBe('2025-01-01');
    });

    it('jitter è deterministico per stesso leadId', () => {
        const a = resolveFollowUpCadence({ id: 42, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: 0 }, null);
        const b = resolveFollowUpCadence({ id: 42, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: 0 }, null);
        expect(a.jitterDays).toBe(b.jitterDays);
    });

    it('jitter è 0 o 1 (seededUnit arrotondato)', () => {
        for (let id = 0; id < 50; id++) {
            const c = resolveFollowUpCadence({ id, messaged_at: '2025-01-01', follow_up_sent_at: null, follow_up_count: 0 }, null);
            expect([0, 1]).toContain(c.jitterDays);
        }
    });
});
