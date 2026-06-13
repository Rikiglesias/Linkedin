export interface LiveEventMessage {
    type: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

type LiveEventListener = (event: LiveEventMessage) => void;

const listeners = new Set<LiveEventListener>();

// A11-2 (audit-bot): il pub/sub è in-memory effimero — una dashboard offline al momento di un
// evento CRITICO (quarantena, pausa automazione, challenge) lo perde dal live-feed SSE. La
// PERSISTENZA durevole di questi eventi esiste già altrove (outbox→cloud + audit_log + broadcast
// Telegram, A11-1): questo ring buffer NON è la SSOT, serve SOLO a ripristinare il live-feed quando
// la dashboard (ri)connette. Solo i tipi critici sono bufferizzati — gli effimeri ad alto volume
// (lead.transition, lead.reconciled, run.log) restano fuori per non gonfiare il replay.
const CRITICAL_EVENT_TYPES = new Set<string>([
    'incident.opened',
    'incident.resolved',
    'system.quarantine',
    'automation.paused',
    'automation.resumed',
    'challenge.review_queued',
]);
const CRITICAL_BUFFER_MAX = 50;
const criticalEventBuffer: LiveEventMessage[] = [];

export function publishLiveEvent(type: string, payload: Record<string, unknown> = {}): void {
    const event: LiveEventMessage = {
        type,
        payload,
        timestamp: new Date().toISOString(),
    };

    if (CRITICAL_EVENT_TYPES.has(type)) {
        criticalEventBuffer.push(event);
        if (criticalEventBuffer.length > CRITICAL_BUFFER_MAX) {
            criticalEventBuffer.shift();
        }
    }

    for (const listener of listeners) {
        try {
            listener(event);
        } catch {
            // Ignore listener failures to keep notifications non-blocking.
        }
    }
}

export function subscribeLiveEvents(listener: LiveEventListener): () => void {
    listeners.add(listener);
    // A11-2: replay degli eventi critici recenti al (ri)connect — la dashboard recupera nel
    // live-feed gli incidenti avvenuti mentre era offline. Gli eventi replayed portano
    // `_replayed: true` nel payload così il client può distinguerli da quelli nuovi (e dedupare
    // per `timestamp`, univoco ISO). Il replay è non-bloccante come la publish.
    for (const event of criticalEventBuffer) {
        try {
            listener({ ...event, payload: { ...event.payload, _replayed: true } });
        } catch {
            // Ignore listener failures to keep replay non-blocking.
        }
    }
    return () => listeners.delete(listener);
}

export function getLiveEventSubscribersCount(): number {
    return listeners.size;
}
