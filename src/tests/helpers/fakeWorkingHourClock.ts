import { vi } from 'vitest';

import { isWorkingHour } from '../../config';
import { getSessionVarianceFactor } from '../../core/preventiveGuards';

/**
 * Blocca SOLO `Date` su un istante feriale dentro l'orario lavorativo in cui la varianza di sessione
 * dell'account non salta il giorno (`getSessionVarianceFactor` = 0 nel 5% dei giorni, per hash
 * deterministico di `accountId:data`). Serve ai test che attraversano scheduler/orchestrator REALI:
 * senza, lo stesso test è verde di giorno e rosso di notte, nel weekend o nel «giorno saltato».
 *
 * Non tocca i timer (setTimeout/Promise): solo l'orologio letto da `new Date()`/`Date.now()`.
 * Ritorna la funzione che ripristina l'orologio reale (da chiamare in `afterAll`/`finally`).
 */
export function freezeClockInsideWorkingHours(accountId = 'default'): { instant: Date; restore: () => void } {
    // Mercoledì 2026-09-09 alle 11:30 Europe/Rome come ancora; si scorre di un giorno finché non è
    // feriale, in orario e senza skip-day. Il ciclo è deterministico: la config e l'hash non cambiano.
    const anchor = new Date('2026-09-09T09:30:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let day = 0; day < 60; day++) {
        const candidate = new Date(anchor.getTime() + day * 24 * 60 * 60 * 1000);
        vi.setSystemTime(candidate);
        if (isWorkingHour(candidate) && getSessionVarianceFactor(accountId) > 0) {
            return { instant: candidate, restore: () => vi.useRealTimers() };
        }
    }
    vi.useRealTimers();
    throw new Error('freezeClockInsideWorkingHours: nessun istante utile in 60 giorni (config orari incoerente?)');
}
