import { describe, test, expect, vi, beforeEach } from 'vitest';

// Ondata-1: il fallback di cleanLeadDataWithAI passava rawFirst grezzo a new RegExp() -> crash su
// nomi con metacaratteri regex ('(', '+', '['). Ora viene escapato.

const mocks = vi.hoisted(() => ({ requestAiText: vi.fn(), logWarn: vi.fn() }));
vi.mock('../ai/aiTextClient', () => ({ requestAiText: mocks.requestAiText }));
vi.mock('../telemetry/logger', () => ({ logWarn: mocks.logWarn }));

import { cleanLeadDataWithAI } from '../ai/leadDataCleaner';

describe('cleanLeadDataWithAI fallback regex-safe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.logWarn.mockResolvedValue(undefined);
    });

    test('fallback non crasha con nome che contiene metacaratteri regex', async () => {
        mocks.requestAiText.mockRejectedValue(new Error('AI down')); // forza il ramo catch/fallback
        const result = await cleanLeadDataWithAI({
            firstName: 'Jo(hn',
            lastName: 'Jo(hn Smith', // contiene rawFirst -> nameDuplicated, attiva il replace con RegExp
            jobTitle: '2°',
            accountName: '3°',
            linkedinUrl: 'https://example.com/in/x',
        });
        expect(result.cleaned).toBe(true);
        expect(result.lastName).toBe('Smith'); // 'Jo(hn' rimosso dal cognome senza crash
    });
});
