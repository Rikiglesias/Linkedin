export interface LiveEventMessage {
    type: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

type LiveEventListener = (event: LiveEventMessage) => void;

const listeners = new Set<LiveEventListener>();

export function publishLiveEvent(type: string, payload: Record<string, unknown> = {}): void {
    const event: LiveEventMessage = {
        type,
        payload,
        timestamp: new Date().toISOString(),
    };

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
    return () => listeners.delete(listener);
}

export function getLiveEventSubscribersCount(): number {
    return listeners.size;
}
