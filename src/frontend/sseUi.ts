/**
 * frontend/sseUi.ts
 * ─────────────────────────────────────────────────────────────────
 * UI per lo stato della connessione SSE: indicatore, favicon, notifiche browser.
 * Estratto da main.ts per ridurre la dimensione del file principale.
 */

import type { SseConnectionState } from './realtime';

let sseDisconnectedAt: number | null = null;
let sseDisconnectedTimer: number | null = null;

function formatDisconnectedDuration(ms: number): string {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}min`;
    return `${Math.floor(min / 60)}h ${min % 60}min`;
}

export function updateSseIndicator(state: SseConnectionState): void {
    const el = document.getElementById('sse-indicator');
    const textEl = document.getElementById('sse-text');
    const reconnectBtn = document.getElementById('sse-reconnect') as HTMLButtonElement | null;
    if (!el || !textEl) return;

    if (sseDisconnectedTimer) {
        window.clearInterval(sseDisconnectedTimer);
        sseDisconnectedTimer = null;
    }

    el.classList.remove('sse-unknown', 'sse-connected', 'sse-disconnected');
    switch (state) {
        case 'UNKNOWN':
            el.classList.add('sse-unknown');
            textEl.textContent = 'Connessione...';
            if (reconnectBtn) reconnectBtn.hidden = true;
            sseDisconnectedAt = null;
            break;
        case 'CONNECTED':
            el.classList.add('sse-connected');
            textEl.textContent = 'Live';
            if (reconnectBtn) reconnectBtn.hidden = true;
            sseDisconnectedAt = null;
            break;
        case 'DISCONNECTED':
            el.classList.add('sse-disconnected');
            sseDisconnectedAt = Date.now();
            textEl.textContent = 'Disconnesso (0s)';
            if (reconnectBtn) reconnectBtn.hidden = false;
            sseDisconnectedTimer = window.setInterval(() => {
                if (sseDisconnectedAt) {
                    textEl.textContent = `Disconnesso (${formatDisconnectedDuration(Date.now() - sseDisconnectedAt)})`;
                }
            }, 30_000);
            break;
    }
    updateFavicon(state);
}

export function updateFavicon(state: SseConnectionState): void {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Base icon
    ctx.fillStyle = '#0A66C2';
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LB', 16, 17);

    // State dot overlay (bottom-right)
    if (state !== 'UNKNOWN') {
        ctx.fillStyle = state === 'CONNECTED' ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        ctx.arc(26, 26, 6, 0, Math.PI * 2);
        ctx.fill();
    }

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');
}

// ─── Browser Notifications ───────────────────────────────────────────────────

let notificationsGranted = false;

export function requestNotificationPermission(): void {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        notificationsGranted = true;
        return;
    }
    if (Notification.permission !== 'denied') {
        void Notification.requestPermission().then((perm) => {
            notificationsGranted = perm === 'granted';
        });
    }
}

export function fireDesktopNotification(eventType: string, rawData: string): void {
    if (!notificationsGranted) return;
    // Only notify when tab is not focused
    if (document.hasFocus()) return;

    let title = 'LinkedIn Bot';
    let body = eventType;

    try {
        const parsed = JSON.parse(rawData) as Record<string, unknown>;
        if (eventType === 'incident.opened') {
            const severity = String(parsed.severity ?? 'INFO');
            const type = String(parsed.type ?? 'incident');
            title = `Incidente ${severity}`;
            body = type;
        } else if (eventType === 'system.quarantine') {
            title = 'Quarantena attivata';
            body = String(parsed.reason ?? 'Il sistema è entrato in quarantena');
        } else if (eventType === 'challenge.review_queued') {
            title = 'Challenge rilevato';
            body = 'Un lead richiede review manuale';
        }
    } catch {
        /* use defaults */
    }

    try {
        new Notification(title, {
            body,
            icon: '/favicon.ico',
            tag: `lkbot-${eventType}`,
        });
    } catch {
        /* notification blocked or unavailable */
    }
}
