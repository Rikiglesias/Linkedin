import { afterEach, describe, expect, it } from 'vitest';
import { finestraDwellDellAccount, humanKeystrokeDwellMs } from '../browser/human/keystrokeTiming';
import { impostaSemeAccount } from '../ai/typoGenerator';
import { logNormalDelayMs, logNormalDelayMsResampled } from '../utils/random';

/**
 * FASE 3 — chiude F-2f0c7b95 (picchi ai bordi) e F-6ce4907b (dwell identico su ogni account).
 *
 * 🔴 I due difetti NON hanno lo stesso rimedio, ed e' il punto che sfugge leggendo in fretta:
 * spostare la mediana per account MUOVE i picchi, non li toglie (ogni account avrebbe i suoi due).
 * I picchi sono colpa del CLAMP, e si tolgono riestraendo il campione fuori range.
 *
 * Il test vecchio (`distinti.size > 3`) non poteva accorgersene: passa benissimo con due picchi
 * enormi, perche' conta quanti valori diversi ci sono, non COME sono distribuiti.
 */

const ENV_ORIGINALE = process.env.ACCOUNT_ID;

afterEach(() => {
    if (ENV_ORIGINALE === undefined) delete process.env.ACCOUNT_ID;
    else process.env.ACCOUNT_ID = ENV_ORIGINALE;
    // Lo stato di sessione e' globale al modulo: senza reset un test inquinerebbe i successivi.
    impostaSemeAccount('');
});

function istogramma(campioni: number[]): Map<number, number> {
    const conteggi = new Map<number, number>();
    for (const c of campioni) conteggi.set(c, (conteggi.get(c) ?? 0) + 1);
    return conteggi;
}

/** Quota del valore piu' frequente, in percentuale sul totale. */
function quotaPiccoMassimo(campioni: number[]): number {
    const massimo = Math.max(...istogramma(campioni).values());
    return (massimo / campioni.length) * 100;
}

/**
 * Soglia che SEPARA i due regimi, misurata sulle funzioni vere (40 ripetizioni x 10.000 campioni):
 *   - resampling (atteso):  picco 2.64% - 2.94%
 *   - clamp (il difetto):   picco 7.63% - 8.90%
 * La soglia originale era 3: a 0.06 punti dal massimo reale del regime BUONO, quindi rossa a caso
 * ogni tanto (colta dal gate il 2026-08-05). 5 lascia margine da entrambi i lati senza togliere
 * potere discriminante: col clamp il test fallisce comunque, sempre.
 *
 * ⚠️ I due numeri sopra valgono per la finestra 62-118 e per il SEME FISSATO qui sotto. La finestra
 * del dwell dipende dall'account (mediana 75-95 ms): con un seme che la stringe, il picco sale
 * (~3.2% misurato al seme minimo). Per questo i test seedano esplicitamente invece di ereditare
 * l'ACCOUNT_ID dell'ambiente — altrimenti la stessa asserzione misurerebbe regimi diversi a ogni
 * macchina, ed e' il modo in cui si ricrea il rosso intermittente appena chiuso.
 */
const QUOTA_PICCO_MAX_PCT = 5;

/** Seme fisso dei test di distribuzione: rende la finestra del dwell riproducibile. */
const SEME_TEST = 'dwell-test@example.com';

describe('F-2f0c7b95 — il clamp creava due picchi, il resampling no', () => {
    const N = 10_000;

    it('ROSSO DI CONTROLLO: col clamp i due bordi diventano i valori piu' + " frequenti", () => {
        const campioni = Array.from({ length: N }, () => logNormalDelayMs(85, 0.22, 62, 118));
        const conteggi = istogramma(campioni);

        const suiBordi = ((conteggi.get(62) ?? 0) + (conteggi.get(118) ?? 0)) / N;
        // ~14% dei campioni schiacciato su DUE soli interi.
        expect(suiBordi).toBeGreaterThan(0.1);
        // ...e ciascun bordo batte qualunque valore interno.
        const interni = [...conteggi.entries()].filter(([v]) => v > 62 && v < 118).map(([, n]) => n);
        expect(conteggi.get(62) ?? 0).toBeGreaterThan(Math.max(...interni));
    });

    it('col resampling nessun singolo valore domina i campioni', () => {
        impostaSemeAccount(SEME_TEST);
        const campioni = Array.from({ length: N }, () => logNormalDelayMsResampled(85, 0.22, 62, 118));

        expect(quotaPiccoMassimo(campioni)).toBeLessThan(QUOTA_PICCO_MAX_PCT);
        // E nessun campione esce comunque dalla finestra.
        expect(Math.min(...campioni)).toBeGreaterThanOrEqual(62);
        expect(Math.max(...campioni)).toBeLessThanOrEqual(118);
    });

    it('il dwell reale non ha piu' + " picchi ai bordi", () => {
        impostaSemeAccount(SEME_TEST);
        const campioni = Array.from({ length: N }, () => humanKeystrokeDwellMs());
        expect(quotaPiccoMassimo(campioni)).toBeLessThan(QUOTA_PICCO_MAX_PCT);
    });
});

describe('F-6ce4907b — due account non hanno lo stesso hold-time', () => {
    it('ACCOUNT_ID diversi ⇒ mediane diverse (il correlatore cross-account sparisce)', () => {
        process.env.ACCOUNT_ID = 'account-alfa@example.com';
        const alfa = finestraDwellDellAccount().medianaMs;

        process.env.ACCOUNT_ID = 'account-beta@example.com';
        const beta = finestraDwellDellAccount().medianaMs;

        expect(alfa).not.toBeCloseTo(beta, 1);
    });

    it("ROSSO DI CONTROLLO: senza l'account della sessione il seme cade sulla stringa vuota ⇒ finestra UNICA", () => {
        // `ACCOUNT_ID`/`LINKEDIN_ACCOUNT` non sono valorizzati DA NESSUNA PARTE in questo progetto
        // (nessun .env.example, compose o config): affidarsi solo a loro significa seme costante,
        // cioe' lo stesso hold-time su tutti gli account — il correlatore che si vuole eliminare.
        delete process.env.ACCOUNT_ID;
        impostaSemeAccount('');
        const senzaAccount = finestraDwellDellAccount().medianaMs;
        impostaSemeAccount('');
        expect(finestraDwellDellAccount().medianaMs).toBe(senzaAccount);

        // Con l'account REALE della sessione (quello che `launchBrowser` passa) le finestre divergono.
        impostaSemeAccount('sessione-account-alfa');
        const alfa = finestraDwellDellAccount().medianaMs;
        impostaSemeAccount('sessione-account-beta');
        const beta = finestraDwellDellAccount().medianaMs;

        expect(alfa).not.toBeCloseTo(beta, 1);
    });

    it("l'account della sessione VINCE sull'env (la sorgente autorevole e' il launcher)", () => {
        process.env.ACCOUNT_ID = 'da-env';
        impostaSemeAccount('da-sessione');
        const conSessione = finestraDwellDellAccount().medianaMs;

        impostaSemeAccount('');
        process.env.ACCOUNT_ID = 'da-env';
        const soloEnv = finestraDwellDellAccount().medianaMs;

        expect(conSessione).not.toBeCloseTo(soloEnv, 1);
    });

    it('lo stesso ACCOUNT_ID da sempre la stessa finestra (deterministico, non casuale)', () => {
        process.env.ACCOUNT_ID = 'account-alfa@example.com';
        const primo = finestraDwellDellAccount();
        const secondo = finestraDwellDellAccount();

        expect(primo).toEqual(secondo);
    });

    it('nessun seme puo' + " portare il dwell nella zona-bot (<50 ms)", () => {
        // Copre l'intero spazio dei semi, non solo quello dell'ambiente corrente.
        for (const id of ['', 'a', 'zzzz', 'account-1', 'account-2', 'un-id-molto-lungo-per-il-hash']) {
            process.env.ACCOUNT_ID = id;
            const finestra = finestraDwellDellAccount();
            expect(finestra.minMs).toBeGreaterThanOrEqual(55);
            expect(finestra.medianaMs).toBeGreaterThan(finestra.minMs);
            expect(finestra.maxMs).toBeGreaterThan(finestra.medianaMs);
        }
    });

    it('la mediana resta nei tempi di battitura plausibili (75-95 ms)', () => {
        for (const id of ['', 'a', 'zzzz', 'account-1', 'account-2']) {
            process.env.ACCOUNT_ID = id;
            const { medianaMs } = finestraDwellDellAccount();
            expect(medianaMs).toBeGreaterThanOrEqual(74);
            expect(medianaMs).toBeLessThanOrEqual(96);
        }
    });
});
