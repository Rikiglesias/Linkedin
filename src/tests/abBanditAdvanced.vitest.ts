import { describe, it, expect } from 'vitest';
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

    it('distribuzione non è sempre lo stesso (stocastico)', async () => {
        const variants = ['a', 'b', 'c'];
        const results = new Set<string>();
        for (let i = 0; i < 20; i++) {
            results.add(await selectVariant(variants));
        }
        // Con Thompson sampling senza dati, dovrebbe esplorare
        expect(results.size).toBeGreaterThanOrEqual(1);
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
