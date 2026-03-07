import { BrowserFingerprint } from '../stealth';

export interface FingerprintSet {
    id: string;
    userAgent: string;
    viewport: { width: number; height: number };
    canvasNoise: number;
    webglNoise: number;
    audioNoise: number;
}

export class FingerprintPool {
    /**
     * Genera un profilo coerente partendo dalla BrowserFingerprint.
     * Tutti i seed di rumore (canvas, webgl, audio) sono derivati
     * dall'UserAgent + ID per garantire che lo stesso fingerprint
     * restituisca sempre lo stesso set combinatorio (evitando rotazioni
     * instabili intra-sessione che allertano l'anti-bot).
     */
    /**
     * FNV-1a 32-bit hash — much better distribution than djb2
     * for generating unique noise values from seeds.
     */
    private static fnv1a(input: string): number {
        let hash = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return hash >>> 0;
    }

    /**
     * Generate a noise value in [0.000001, 0.01] from a seed string.
     * Uses FNV-1a with modulo 10000 for 10k unique values (vs previous 12).
     */
    private static noiseFromSeed(seed: string): number {
        const hash = FingerprintPool.fnv1a(seed);
        return Math.max(0.000001, (hash % 10000) / 1000000);
    }

    public static generateConsistentProfile(base: BrowserFingerprint): FingerprintSet {
        const seedBase = `${base.userAgent}|${base.id}`;

        return {
            id: base.id,
            userAgent: base.userAgent,
            viewport: base.viewport ?? { width: 1280, height: 800 },
            canvasNoise: FingerprintPool.noiseFromSeed(`canvas:${seedBase}`),
            webglNoise: FingerprintPool.noiseFromSeed(`webgl:${seedBase}`),
            audioNoise: FingerprintPool.noiseFromSeed(`audio:${seedBase}`),
        };
    }
}
