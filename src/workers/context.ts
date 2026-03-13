import { BrowserSession } from '../browser';
import type { BehavioralProfile } from '../browser/sessionCookieMonitor';

export interface WorkerContext {
    session: BrowserSession;
    dryRun: boolean;
    localDate: string;
    accountId: string;
    /** Profilo comportamentale per-account: modula delay, scroll speed, etc. (NEW-4) */
    behavioralProfile?: BehavioralProfile;
    /** Cache profili già visitati oggi — evita duplicate profile view sullo stesso target */
    visitedProfilesToday?: Set<string>;
}
