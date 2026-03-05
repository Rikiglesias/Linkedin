import { BrowserSession } from '../browser';
import { ThrottleSignal } from '../risk/httpThrottler';

export interface WorkerContext {
    session: BrowserSession;
    dryRun: boolean;
    localDate: string;
    accountId: string;
}

/**
 * Interroga il throttler della sessione browser e restituisce il segnale corrente.
 * Usato dai worker per rallentare proattivamente prima di un 429.
 */
export function getThrottleSignal(context: WorkerContext): ThrottleSignal {
    return context.session.httpThrottler.getThrottleSignal();
}
