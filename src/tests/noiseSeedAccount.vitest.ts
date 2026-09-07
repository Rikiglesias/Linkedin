import { describe, it, expect } from 'vitest';
import { FingerprintPool } from '../fingerprint/noiseGenerator';
import { desktopFingerprintPool, pickDeterministicFingerprint } from '../fingerprint/pool';

/**
 * C25 — Il rumore (canvas/webgl/audio) e' seedato sull'ACCOUNT, non solo sulla entry del pool.
 *
 * Perche' conta (anti-ban): `pickDeterministicFingerprint` sceglie l'elemento del pool a partire
 * dall'accountId, ma il pool desktop ha ~20 entry: due account COLLIDONO per forza sulla stessa
 * entry. Se il seme del rumore e' `userAgent|id` della entry, quei due account espongono canvas,
 * webgl e audio hash IDENTICI ⇒ correlatore cross-account, la stessa classe che
 * `impostaSemeAccount` (`launcher.ts:288`) ha gia' chiuso sul dwell dei tasti.
 *
 * Il test lavora sul percorso REALE (entry presa dal pool via `pickDeterministicFingerprint`),
 * non su entry costruite a mano con `id` gia' diverso per account: quella forma passerebbe anche
 * con il bug (cfr. `canvasNoiseFloor.vitest.ts:37`).
 */
describe('C25 — seme del rumore legato all\'account', () => {
    const entry = desktopFingerprintPool[0] as (typeof desktopFingerprintPool)[number];

    it('stessa entry del pool + 2 account diversi → i tre assi di rumore sono diversi', () => {
        const a = FingerprintPool.generateConsistentProfile(entry, 'account-alfa');
        const b = FingerprintPool.generateConsistentProfile(entry, 'account-beta');

        expect(a.canvasNoise).not.toBe(b.canvasNoise);
        expect(a.webglNoise).not.toBe(b.webglNoise);
        expect(a.audioNoise).not.toBe(b.audioNoise);
    });

    it('stesso account 2× → rumore identico (un device reale non muta fra due sessioni)', () => {
        const primo = FingerprintPool.generateConsistentProfile(entry, 'account-stabile');
        const secondo = FingerprintPool.generateConsistentProfile(entry, 'account-stabile');

        expect(secondo).toEqual(primo);
    });

    it('percorso reale: 2 account che collidono sulla STESSA entry del pool restano distinguibili', () => {
        // Coppia di account che `pickDeterministicFingerprint` manda sulla stessa entry.
        let primo: string | null = null;
        let secondo: string | null = null;
        const visti = new Map<string, string>();
        for (let i = 0; i < 500 && secondo === null; i++) {
            const accountId = `account-${i}`;
            const scelta = pickDeterministicFingerprint(desktopFingerprintPool, accountId).id;
            const gia = visti.get(scelta);
            if (gia) {
                primo = gia;
                secondo = accountId;
            } else {
                visti.set(scelta, accountId);
            }
        }
        expect(primo, 'nessuna collisione trovata nel pool: rivedere il campione').not.toBeNull();

        const entryPrimo = pickDeterministicFingerprint(desktopFingerprintPool, primo as string);
        const entrySecondo = pickDeterministicFingerprint(desktopFingerprintPool, secondo as string);
        expect(entrySecondo.id).toBe(entryPrimo.id); // stessa entry: la collisione e' il presupposto

        const rumorePrimo = FingerprintPool.generateConsistentProfile(entryPrimo, primo as string);
        const rumoreSecondo = FingerprintPool.generateConsistentProfile(entrySecondo, secondo as string);

        expect(rumoreSecondo.canvasNoise).not.toBe(rumorePrimo.canvasNoise);
        expect(rumoreSecondo.webglNoise).not.toBe(rumorePrimo.webglNoise);
        expect(rumoreSecondo.audioNoise).not.toBe(rumorePrimo.audioNoise);
    });

    // Superset dichiarato oltre i 3 casi del contratto: un accountId vuoto azzererebbe in silenzio
    // la distinzione fra account (fail-open), quindi deve fallire il lancio, non degradare.
    it('accountId vuoto → errore, mai un seme condiviso in silenzio', () => {
        expect(() => FingerprintPool.generateConsistentProfile(entry, '')).toThrow(/accountId/i);
        expect(() => FingerprintPool.generateConsistentProfile(entry, '   ')).toThrow(/accountId/i);
    });
});
