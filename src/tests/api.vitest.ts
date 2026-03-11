import assert from 'assert';
import { describe, test, expect } from 'vitest';

describe('Zod Schemas', () => {
    test('PauseSchema valida correttamente', async () => {
        const { PauseSchema } = await import('../api/schemas');
        expect(PauseSchema.safeParse({ minutes: 60 }).success).toBe(true);
        expect(PauseSchema.safeParse({ minutes: 0 }).success).toBe(false);
        expect(PauseSchema.safeParse({ minutes: 99999 }).success).toBe(false);
        expect(PauseSchema.safeParse({}).success).toBe(false);
    });

    test('ExportLeadsQuerySchema default JSON', async () => {
        const { ExportLeadsQuerySchema } = await import('../api/schemas');
        const result = ExportLeadsQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.format).toBe('json');
        }
    });

    test('QuarantineSchema supporta enabled e action', async () => {
        const { QuarantineSchema } = await import('../api/schemas');
        expect(QuarantineSchema.safeParse({ enabled: true }).success).toBe(true);
        expect(QuarantineSchema.safeParse({ enabled: false }).success).toBe(true);
        expect(QuarantineSchema.safeParse({ action: 'set' }).success).toBe(true);
        expect(QuarantineSchema.safeParse({ action: 'clear' }).success).toBe(true);
        expect(QuarantineSchema.safeParse({}).success).toBe(false);
    });
});

describe('API Error Format', () => {
    test('handleApiError gestisce ZodError', async () => {
        const { z } = await import('zod');
        const { handleApiError } = await import('../api/utils');

        let capturedStatus = 0;
        let capturedBody: unknown = null;
        const fakeRes = {
            status: (code: number) => {
                capturedStatus = code;
                return {
                    json: (body: unknown) => {
                        capturedBody = body;
                    },
                };
            },
        } as never;

        const zodError = z.object({ x: z.number() }).safeParse({ x: 'abc' });
        assert.equal(zodError.success, false);
        if (!zodError.success) {
            handleApiError(fakeRes, zodError.error, 'test');
            expect(capturedStatus).toBe(400);
            expect(capturedBody).toHaveProperty('error');
            expect((capturedBody as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
        }
    });
});
