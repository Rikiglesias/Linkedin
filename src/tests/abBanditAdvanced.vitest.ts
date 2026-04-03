import { describe, it, expect, vi } from 'vitest';
import { selectVariant, inferHourBucket } from '../ml/abBandit';

describe('abBandit — selectVariant', () => {
    it('ritorna uno dei variants forniti', async () => {
        const variants = ['variant_a', 'variant_b', 'variant_c'];
        const selected = await selectVariant(variants);
        expect(variants).toContain(selected);
    });

    it('con un solo variant → ritorna sempre quello', async () => {
        const selected = await selectVariant(['only_one']);
        expect(selected).toBe('only_one');
    });

    it('lancia con array vuoto', async () => {
        await expect(selectVariant([])).rejects.toThrow();
    });

    it('senza explore forzata usa il ramo exploit deterministico', async () => {
        const variants = ['a', 'b', 'c'];
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
        try {
            const selected = await selectVariant(variants);
            expect(selected).toBe('a');
        } finally {
            randomSpy.mockRestore();
        }
    });

    it('con explore forzata ritorna comunque una variante valida', async () => {
        const variants = ['a', 'b', 'c'];
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const selected = await selectVariant(variants);
            expect(variants).toContain(selected);
        } finally {
            randomSpy.mockRestore();
        }
    });

    it('accetta context opzionale', async () => {
        const selected = await selectVariant(['x', 'y'], {
            segmentKey: 'c_level',
            hourBucket: 'morning',
        });
        expect(['x', 'y']).toContain(selected);
    });
});

describe('inferHourBucket — completeness', () => {
    it('ogni ora 0-23 ritorna un valore definito o undefined', () => {
        for (let h = 0; h < 24; h++) {
            const result = inferHourBucket(h);
            if (result !== undefined) {
                expect(['morning', 'afternoon', 'evening']).toContain(result);
            }
        }
    });

    it('ore negative → undefined', () => {
        expect(inferHourBucket(-1)).toBeUndefined();
    });

    it('ore > 23 → undefined', () => {
        expect(inferHourBucket(24)).toBeUndefined();
        expect(inferHourBucket(100)).toBeUndefined();
    });
});
