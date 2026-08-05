/**
 * payloadParsingSemantics.vitest.ts
 *
 * Blocca la classe di difetto trovata dal 4o critico nel goal audit-codebase (2026-08-05):
 * nel repo esistevano DUE funzioni omonime `parsePayload` con semantica OPPOSTA —
 * `core/repositories/shared.ts` ripiega su `{}`, quella locale di `workers/registry.ts` lancia.
 *
 * La conseguenza non era estetica: `parseJobPayload` (jobs.ts) usa quella che INGHIOTTE, quindi su un
 * `payload_json` corrotto il chiamante riceveva `{}` senza alcuna eccezione => il suo `catch` non
 * scattava e la logica di recupero (failLeadCampaign, il fix NEW-8 contro lo stuck) non partiva mai:
 * campagna bloccata IN SILENZIO.
 *
 * Questi test fissano il contratto delle due semantiche, cosi' che un futuro "consolidamento" delle
 * due funzioni non possa riportare il silenzio senza far fallire la suite.
 */
import { describe, it, expect } from 'vitest';
import { parsePayload, tryParsePayload } from '../core/repositories/shared';

const CORROTTO = '{"leadId": 42, "campaignStateId":';
const VALIDO = '{"leadId": 42, "campaignStateId": 7}';

describe('parsing dei payload — le due semantiche sono DISTINTE e devono restare tali', () => {
    it('parsePayload INGHIOTTE: su JSON corrotto ritorna {} e non lancia (comportamento storico)', () => {
        expect(() => parsePayload(CORROTTO)).not.toThrow();
        expect(parsePayload<Record<string, unknown>>(CORROTTO)).toEqual({});
    });

    it('parsePayload rende un payload corrotto INDISTINGUIBILE da uno vuoto — la radice del silenzio', () => {
        // Se questo smettesse di valere, tryParsePayload non servirebbe piu'.
        expect(parsePayload<Record<string, unknown>>(CORROTTO)).toEqual(parsePayload<Record<string, unknown>>('{}'));
    });

    it('tryParsePayload DISTINGUE: ok=false su corrotto, ok=true su valido', () => {
        const corrotto = tryParsePayload<{ campaignStateId?: number }>(CORROTTO);
        expect(corrotto.ok).toBe(false);
        expect(corrotto.value).toEqual({});

        const valido = tryParsePayload<{ campaignStateId?: number }>(VALIDO);
        expect(valido.ok).toBe(true);
        expect(valido.value.campaignStateId).toBe(7);
    });

    it('tryParsePayload distingue anche il payload legittimamente VUOTO dal corrotto', () => {
        // E' il caso che il ramo campaign-advance deve separare: "job non di campagna" (normale)
        // contro "payload illeggibile" (da segnalare).
        const vuoto = tryParsePayload<{ campaignStateId?: number }>('{}');
        expect(vuoto.ok).toBe(true);
        expect(vuoto.value.campaignStateId).toBeUndefined();

        const corrotto = tryParsePayload<{ campaignStateId?: number }>(CORROTTO);
        expect(corrotto.ok).toBe(false);
        expect(corrotto.value.campaignStateId).toBeUndefined();
        // Stesso VALORE, ma ok diverso: e' esattamente l'informazione che prima andava persa.
        expect(vuoto.value).toEqual(corrotto.value);
        expect(vuoto.ok).not.toBe(corrotto.ok);
    });

    it('tryParsePayload non lancia mai: e nemmeno su input non-JSON', () => {
        expect(() => tryParsePayload('')).not.toThrow();
        expect(tryParsePayload('').ok).toBe(false);
        expect(() => tryParsePayload('non json affatto')).not.toThrow();
        expect(tryParsePayload('non json affatto').ok).toBe(false);
    });
});
