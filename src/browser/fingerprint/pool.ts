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
    public static generateConsistentProfile(base: BrowserFingerprint): FingerprintSet {
        const seedString = `${base.userAgent}|${base.id}`;
        let hash = 0;
        for (let i = 0; i < seedString.length; i++) {
            const char = seedString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }

        const positiveHash = Math.abs(hash);

        return {
            id: base.id,
            userAgent: base.userAgent,
            viewport: base.viewport ?? { width: 1280, height: 800 },
            canvasNoise: (positiveHash % 1000) / 100000,
            webglNoise: ((positiveHash * 7) % 1000) / 100000,
            audioNoise: ((positiveHash * 13) % 1000) / 100000
        };
    }
}
