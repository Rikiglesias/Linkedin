/**
 * utils/random.ts
 * ─────────────────────────────────────────────────────────────────
 * Utility condivise per generazione numeri random e selezione
 * casuale da array. Consolidamento di funzioni duplicate
 * da humanBehavior.ts, organicContent.ts, jobRunner.ts, stealth.ts,
 * postContentGenerator.ts, scheduler.ts, fingerprint/pool.ts,
 * abBandit.ts, randomActivityWorker.ts.
 */

import { randomInt as cryptoRandomInt } from 'crypto';

/**
 * Ritorna un intero casuale tra min e max (inclusi).
 * Gestisce correttamente min > max invertendo i valori.
 * Usa crypto.randomInt per distribuzione uniforme non predicibile.
 */
export function randomInt(min: number, max: number): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    if (low === high) return low;
    return cryptoRandomInt(low, high + 1);
}

/**
 * Seleziona un elemento casuale da un array readonly.
 * L'array DEVE avere almeno un elemento — il chiamante è responsabile.
 */
export function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[cryptoRandomInt(0, arr.length)] as T;
}

/**
 * Campione da una normale standard N(0,1) via Box-Muller. Usa crypto per unpredictability,
 * coerente col resto del modulo.
 */
export function sampleStandardNormal(): number {
    const u1 = cryptoRandomInt(1, 1_000_001) / 1_000_001; // (0,1], mai 0 → log sicuro
    const u2 = cryptoRandomInt(0, 1_000_000) / 1_000_000; // [0,1)
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Delay in ms da una distribuzione LOG-NORMALE (right-skew), la forma reale dei tempi umani
 * (inter-keystroke, pause): mediana ~`medianMs`, dispersione `sigma`, clampato a [minMs, maxMs].
 * Anti-ban: i delay uniformi (Math.random()*range) producono un istogramma piatto rilevabile dal
 * behavioral fingerprinting; la log-normale replica la coda destra naturale (fonti: keystroke
 * dynamics, distribuzione log-normale/ex-gaussian dei flight time).
 */
export function logNormalDelayMs(medianMs: number, sigma: number, minMs: number, maxMs: number): number {
    const sample = medianMs * Math.exp(sigma * sampleStandardNormal());
    return Math.round(Math.max(minMs, Math.min(maxMs, sample)));
}

/**
 * Gemella in SECONDI di {@link logNormalDelayMs}: stessa forma log-normale (right-skew), clampata a
 * [minSec, maxSec]. Per gli spacing anti-burst dello scheduler, dove l'inter-arrival tra azioni
 * consecutive NON è uniforme (istogramma piatto rilevabile) ma right-skewed come i tempi umani reali.
 */
export function logNormalDelaySec(medianSec: number, sigma: number, minSec: number, maxSec: number): number {
    const sample = medianSec * Math.exp(sigma * sampleStandardNormal());
    return Math.round(Math.max(minSec, Math.min(maxSec, sample)));
}
