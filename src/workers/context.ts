import { BrowserSession } from '../browser';
import type { BehavioralProfile } from '../browser/sessionCookieMonitor';

// ─── Session Replay Breadcrumbs (6.7) ───────────────────────────────────────

export interface SessionBreadcrumb {
    timestamp: number;
    action: string;
    url?: string;
    detail?: string;
}

const MAX_BREADCRUMBS = 20;

/**
 * Aggiunge un breadcrumb alla lista circolare nel context.
 * Ultimi 20 eventi — su challenge/errore vengono dumpati nel record incidente.
 */
export function addBreadcrumb(context: WorkerContext, action: string, detail?: string): void {
    if (!context.breadcrumbs) context.breadcrumbs = [];
    context.breadcrumbs.push({
        timestamp: Date.now(),
        action,
        url: context.session?.page?.url?.() ?? undefined,
        detail: detail?.substring(0, 200),
    });
    // Circolare: mantieni solo gli ultimi MAX_BREADCRUMBS
    if (context.breadcrumbs.length > MAX_BREADCRUMBS) {
        context.breadcrumbs = context.breadcrumbs.slice(-MAX_BREADCRUMBS);
    }
}

/**
 * Formatta i breadcrumbs per inclusione in log/alert Telegram.
 */
export function formatBreadcrumbs(context: WorkerContext): string {
    if (!context.breadcrumbs || context.breadcrumbs.length === 0) return '(nessun breadcrumb)';
    return context.breadcrumbs
        .map((b) => {
            const time = new Date(b.timestamp).toISOString().substring(11, 19);
            const urlShort = b.url ? ` [${b.url.substring(0, 50)}]` : '';
            return `${time} ${b.action}${urlShort}${b.detail ? ` — ${b.detail}` : ''}`;
        })
        .join('\n');
}

// ─── WorkerContext ────────────────────────────────────────────────────────────

export interface WorkerContext {
    session: BrowserSession;
    dryRun: boolean;
    localDate: string;
    accountId: string;
    /** Profilo comportamentale per-account: modula delay, scroll speed, etc. (NEW-4) */
    behavioralProfile?: BehavioralProfile;
    /** Cache profili già visitati oggi — evita duplicate profile view sullo stesso target */
    visitedProfilesToday?: Set<string>;
    /** Fattore riduzione velocità azioni durante wind-down sessione (0 = nessuna riduzione, 0.3 = -30%) (1.1) */
    windDownSpeedReduction?: number;
    /** Session Replay Breadcrumbs (6.7): ultimi 20 eventi navigazione per debugging challenge */
    breadcrumbs?: SessionBreadcrumb[];
    /** Contatore azioni nella sessione corrente — usato per decay navigazione organica (C05) */
    sessionActionCount?: number;
    /** Timestamp (ms) inizio sessione — usato per AI session duration */
    sessionStartedAtMs?: number;
}
