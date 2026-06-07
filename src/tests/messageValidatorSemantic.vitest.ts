import { describe, test, expect, vi, beforeEach } from 'vitest';

// Ondata-3: il catch del semantic check era muto (fail-open silenzioso). Ora logga e prosegue.
const mocks = vi.hoisted(() => ({ isTooSimilar: vi.fn(), logWarn: vi.fn() }));
vi.mock('../ai/semanticChecker', () => ({ SemanticChecker: { isTooSimilar: mocks.isTooSimilar } }));
vi.mock('../telemetry/logger', () => ({ logWarn: mocks.logWarn }));

import { validateMessageContentAsync } from '../validation/messageValidator';

describe('validateMessageContentAsync catch logga (Ondata-3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.logWarn.mockResolvedValue(undefined);
    });

    test('semantic check che lancia → logWarn + prosegue best-effort (non fail-open muto)', async () => {
        mocks.isTooSimilar.mockRejectedValue(new Error('embeddings down'));

        const res = await validateMessageContentAsync('Ciao, mi farebbe piacere connettermi con te.', {
            duplicateCountLast24h: 0,
            leadId: 7,
        });

        expect(res.valid).toBe(true); // prosegue con la validazione sincrona
        expect(mocks.logWarn).toHaveBeenCalledWith(
            'message_validator.semantic_check_failed',
            expect.objectContaining({ leadId: 7 }),
        );
    });
});
