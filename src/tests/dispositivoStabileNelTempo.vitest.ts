import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Il dispositivo simulato deve dipendere dall'IDENTITA', non dal CALENDARIO.
//
// `stealth.ts` costruiva i suoi due semi come `${accountId}:mode:week${N}` e
// `${accountId}:cloud:week${N}`, dove N e' il numero di settimana dell'anno. Il commento
// prometteva «stesso account -> stesso fingerprint per ~1 settimana»: cioe' dichiarava una
// rotazione periodica del dispositivo su una sessione LinkedIn autenticata.
//
// Misurato prima di toccare: in FNV-1a l'ultimo carattere del seme entra in una sola
// moltiplicazione, quindi il valore resta quasi fermo al variare della settimana -> solo
// l'1,4% degli account cambiava davvero (28 su 2000). Il risultato e' il peggiore dei due
// mondi: la rotazione promessa non c'e', e quel poco che ruota lo fa a caso, cioe' e' un
// cambio di dispositivo senza nessuna contropartita.
//
// I due casi qui sotto sono quel residuo, trovati per enumerazione: `acc-4` passa da desktop
// a mobile e `acc-0` cambia riga del pool cloud fra il 4 e il 12 maggio 2026.

const h = vi.hoisted(() => ({
    config: {
        mobileProbability: 0.3,
        useJa3Proxy: false,
        timezone: 'Europe/Rome',
        ja3Fingerprint: '',
        browserEngine: 'chromium',
    },
}));

vi.mock('../config', () => ({ config: h.config }));
// Il pool sintetico è tutto Chrome e l'engine è chromium: la famiglia rilevata deve essere `chrome` (quella
// reale). Prima il mock rispondeva `chromium`, una famiglia che non esiste: il test passava solo grazie al
// fallback «nessuno coerente → pool intero», che C12 ha tolto (UA↔engine incoerente = spoofing rilevabile).
vi.mock('../proxy/ja3Validator', () => ({ detectBrowserFamily: () => 'chrome' }));

import { pickBrowserFingerprint, pickFingerprintMode } from '../browser/stealth';
import type { CloudFingerprint } from '../browser/stealth';

const LUNEDI = new Date(2026, 4, 4, 12, 0, 0);
const OTTO_GIORNI_DOPO = new Date(2026, 4, 12, 12, 0, 0);

/** Pool cloud sintetico: 23 righe coerenti con l'engine chromium (come il pool reale). */
const POOL: CloudFingerprint[] = Array.from({ length: 23 }, (_, i) => ({
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1${i}.0.0.0 Safari/537.36`,
    isMobile: false,
    viewport: { width: 1920, height: 1080 },
})) as unknown as CloudFingerprint[];

function a(data: Date, fn: () => unknown): unknown {
    vi.setSystemTime(data);
    return fn();
}

describe('il dispositivo non ruota col calendario', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    test('la modalita (desktop/mobile) di un account non cambia da una settimana all’altra', () => {
        const prima = a(LUNEDI, () => pickFingerprintMode('acc-4'));
        const dopo = a(OTTO_GIORNI_DOPO, () => pickFingerprintMode('acc-4'));

        expect(dopo).toBe(prima);
    });

    test('il fingerprint scelto dal pool cloud non cambia da una settimana all’altra', () => {
        const prima = a(LUNEDI, () => pickBrowserFingerprint(POOL, false, 'acc-0')) as { userAgent: string };
        const dopo = a(OTTO_GIORNI_DOPO, () => pickBrowserFingerprint(POOL, false, 'acc-0')) as { userAgent: string };

        expect(dopo.userAgent).toBe(prima.userAgent);
    });

    test('la probabilita mobile resta rispettata FRA account (il fix non la annulla)', () => {
        vi.setSystemTime(LUNEDI);
        const mobili = Array.from({ length: 2000 }, (_, i) => pickFingerprintMode(`account-${i}`)).filter(
            Boolean,
        ).length;

        // 30% atteso, banda larga: qui si difende l'ordine di grandezza, non il decimale.
        expect(mobili / 2000).toBeGreaterThan(0.2);
        expect(mobili / 2000).toBeLessThan(0.4);
    });

    test('account diversi restano su dispositivi diversi (il fix non collassa tutti sullo stesso)', () => {
        vi.setSystemTime(LUNEDI);
        const scelti = new Set(
            Array.from({ length: 50 }, (_, i) => (pickBrowserFingerprint(POOL, false, `acc-${i}`) as { userAgent: string }).userAgent),
        );

        expect(scelti.size).toBeGreaterThan(5);
    });
});
