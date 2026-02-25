import { BrowserSession } from '../browser';

export interface WorkerContext {
    session: BrowserSession;
    dryRun: boolean;
    localDate: string;
}

