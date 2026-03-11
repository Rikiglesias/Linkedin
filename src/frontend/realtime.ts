/**
 * frontend/realtime.ts
 * ─────────────────────────────────────────────────────────────────
 * SSE + WebSocket connection management con auto-reconnect.
 * Estratto da main.ts per modularità.
 */

const SSE_RECONNECT_BASE_MS = 2_000;

export type SseConnectionState = 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED';

const TRACKED_EVENTS = [
    'connected',
    'lead.transition',
    'lead.reconciled',
    'incident.opened',
    'incident.resolved',
    'automation.paused',
    'automation.resumed',
    'system.quarantine',
    'challenge.review_queued',
    'run.log',
];

const NOTIFICATION_EVENTS = new Set(['incident.opened', 'system.quarantine', 'challenge.review_queued']);

let eventSource: EventSource | null = null;
let wsConnection: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;

let _onStateChange: (state: SseConnectionState) => void = () => {};
let _onRealtimeEvent: (eventName: string, data: string) => void = () => {};

export function initRealtime(callbacks: {
    onStateChange: (state: SseConnectionState) => void;
    onRealtimeEvent: (eventName: string, data: string) => void;
}): void {
    _onStateChange = callbacks.onStateChange;
    _onRealtimeEvent = callbacks.onRealtimeEvent;
}

function scheduleReconnect(): void {
    reconnectAttempts += 1;
    _onStateChange('DISCONNECTED');
    const delay = Math.min(30_000, SSE_RECONNECT_BASE_MS * Math.pow(2, Math.min(6, reconnectAttempts)));
    reconnectTimer = window.setTimeout(() => {
        if (!document.hidden) {
            connectEventStream();
        }
    }, delay);
}

function connectWebSocket(): boolean {
    if (typeof WebSocket === 'undefined') return false;
    try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${location.host}/ws`);
        ws.onopen = () => {
            wsConnection = ws;
            reconnectAttempts = 0;
            _onStateChange('CONNECTED');
        };
        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data as string) as { type?: string };
                if (msg.type && msg.type !== 'heartbeat' && TRACKED_EVENTS.includes(msg.type)) {
                    _onRealtimeEvent(msg.type, evt.data as string);
                }
            } catch { /* ignore */ }
        };
        ws.onclose = () => {
            wsConnection = null;
            scheduleReconnect();
        };
        ws.onerror = () => { ws.close(); };
        return true;
    } catch {
        return false;
    }
}

function connectSseFallback(): void {
    eventSource = new EventSource('/api/events');
    TRACKED_EVENTS.forEach((eventName) => {
        eventSource?.addEventListener(eventName, (evt: MessageEvent<string>) => {
            _onRealtimeEvent(eventName, evt.data);
        });
    });
    eventSource.onopen = () => {
        reconnectAttempts = 0;
        _onStateChange('CONNECTED');
    };
    eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        scheduleReconnect();
    };
}

export function connectEventStream(): void {
    if (wsConnection) { wsConnection.close(); wsConnection = null; }
    if (eventSource) { eventSource.close(); eventSource = null; }
    if (reconnectTimer) { window.clearTimeout(reconnectTimer); }
    if (!connectWebSocket()) { connectSseFallback(); }
}

export function disconnectEventStream(): void {
    if (wsConnection) { wsConnection.close(); wsConnection = null; }
    if (eventSource) { eventSource.close(); eventSource = null; }
    if (reconnectTimer) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
    _onStateChange('UNKNOWN');
}

export function isNotificationEvent(eventName: string): boolean {
    return NOTIFICATION_EVENTS.has(eventName);
}
