import { BrowserSession } from '../browser';

export interface WorkerContext {
    session: BrowserSession;
    dryRun: boolean;
    localDate: string;
    accountId: string;
    /** Cache profili già visitati oggi — evita duplicate profile view sullo stesso target */
    visitedProfilesToday?: Set<string>;
}
