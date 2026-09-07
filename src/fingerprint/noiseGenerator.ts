import { Fingerprint } from './pool';

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

    /**
     * C25 anti-ban: il seme include l'ACCOUNT, non solo la entry del pool.
     * `pickDeterministicFingerprint` mappa gli account su ~20 entry desktop: due account che
     * collidono sulla stessa entry avrebbero canvas/webgl/audio identici ⇒ correlatore
     * cross-account (stessa classe gia' chiusa sul dwell dei tasti, `launcher.ts:288`).
     * Il valore resta DETERMINISTICO per profilo: stesso account ⇒ stesso rumore a ogni lancio
     * (un rumore che cambia fra due sessioni dello stesso profilo e' esso stesso un segnale).
     * `accountId` e' obbligatorio e non vuoto: un seme vuoto tornerebbe a essere condiviso in
     * silenzio (fail-open). L'identita' persistita lo garantisce sempre valorizzato e stabile
     * per profilo (`browserIdentityRuntime.ts:289`, `IDENTITY_ACCOUNT_MISMATCH` di C52).
     */
    public static generateConsistentProfile(base: Fingerprint, accountId: string): FingerprintSet {
        if (accountId.trim() === '') {
            throw new Error(
                '[FINGERPRINT] accountId vuoto: il rumore canvas/webgl/audio sarebbe condiviso fra account',
            );
        }
        const seedBase = `${base.userAgent}|${base.id}|${accountId}`;

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
