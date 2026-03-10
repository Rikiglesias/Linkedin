import { DashboardApi } from './apiClient';
import { renderInvitesChart, renderRiskGauge } from './charts';
import { byId, setText, exportToCSV, downloadCanvasAsPng, printReport } from './dom';
import {
    renderAbLeaderboard,
    renderCommentSuggestions,
    renderIncidents,
    renderKpiComparison,
    renderKpis,
    renderLeadDetail,
    renderLeadSearchResults,
    renderOperationalSlo,
    renderPredictiveRisk,
    renderReviewQueue,
    renderRuns,
    renderSelectorCacheKpi,
    renderTimeline,
    renderTimingSlots,
} from './renderers';
import { TimelineStore } from './timeline';
import { TimelineFilter, TrendRow } from './types';
import {
    type DashboardVoiceAction,
    describeVoiceAction,
    isCriticalVoiceAction,
    parseVoiceCommand,
} from './voiceCommands';

const POLL_INTERVAL_MS = 20_000;
const SSE_RECONNECT_BASE_MS = 2_000;
const SPEECH_RECOGNITION_LANG = 'it-IT';

interface SpeechRecognitionAlternativeLike {
    transcript: string;
}

interface SpeechRecognitionResultLike {
    readonly length: number;
    readonly isFinal: boolean;
    [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
    readonly resultIndex: number;
    readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
    readonly error?: string;
}

interface SpeechRecognitionLike extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: ((event: Event) => void) | null;
    onend: ((event: Event) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    start(): void;
    stop(): void;
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;
type WindowWithSpeechRecognition = Window & {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

const api = new DashboardApi();
const timeline = new TimelineStore();
const selectedIncidentIds = new Set<number>();
let lastTrendData: TrendRow[] = [];

let eventSource: EventSource | null = null;
let wsConnection: WebSocket | null = null;
let pollTimer: number | null = null;
let refreshTimer: number | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;
const PREFS_KEY = 'lkbot_ui_prefs';

type ThemePreference = 'light' | 'dark' | 'auto';

interface UiPrefs {
    filter: TimelineFilter;
    theme: ThemePreference;
}

function loadUiPrefs(): UiPrefs {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<UiPrefs>;
            return {
                filter: {
                    type: parsed.filter?.type ?? 'all',
                    accountId: parsed.filter?.accountId ?? 'all',
                    listName: parsed.filter?.listName ?? 'all',
                },
                theme: parsed.theme ?? 'auto',
            };
        }
    } catch { /* ignore corrupt data */ }
    return { filter: { type: 'all', accountId: 'all', listName: 'all' }, theme: 'auto' };
}

function applyTheme(theme: ThemePreference): void {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function cycleTheme(current: ThemePreference): ThemePreference {
    if (current === 'auto') return 'dark';
    if (current === 'dark') return 'light';
    return 'auto';
}

function saveUiPrefs(prefs: UiPrefs): void {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch { /* quota exceeded or private browsing */ }
}

const initialPrefs = loadUiPrefs();
let currentFilter: TimelineFilter = initialPrefs.filter;
let currentTheme: ThemePreference = initialPrefs.theme;

// Apply saved theme immediately (before DOM renders charts)
applyTheme(currentTheme);

type SseConnectionState = 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED';

function updateSseIndicator(state: SseConnectionState): void {
    const el = document.getElementById('sse-indicator');
    const textEl = document.getElementById('sse-text');
    const reconnectBtn = document.getElementById('sse-reconnect') as HTMLButtonElement | null;
    if (!el || !textEl) return;

    el.classList.remove('sse-unknown', 'sse-connected', 'sse-disconnected');
    switch (state) {
        case 'UNKNOWN':
            el.classList.add('sse-unknown');
            textEl.textContent = 'Connessione...';
            if (reconnectBtn) reconnectBtn.hidden = true;
            break;
        case 'CONNECTED':
            el.classList.add('sse-connected');
            textEl.textContent = 'Live';
            if (reconnectBtn) reconnectBtn.hidden = true;
            break;
        case 'DISCONNECTED':
            el.classList.add('sse-disconnected');
            textEl.textContent = 'Disconnesso';
            if (reconnectBtn) reconnectBtn.hidden = false;
            break;
    }
    updateFavicon(state);
}

function updateFavicon(state: SseConnectionState): void {
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
let voiceRecognition: SpeechRecognitionLike | null = null;
let isVoiceListening = false;
let pendingVoiceAction: DashboardVoiceAction | null = null;

// ─── Browser Notifications ───────────────────────────────────────────────────

let notificationsGranted = false;

function requestNotificationPermission(): void {
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

function fireDesktopNotification(eventType: string, rawData: string): void {
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
    } catch { /* use defaults */ }

    try {
        new Notification(title, {
            body,
            icon: '/favicon.ico',
            tag: `lkbot-${eventType}`,
        });
    } catch { /* notification blocked or unavailable */ }
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

function scheduleRefresh(delayMs = 250): void {
    if (refreshTimer) {
        window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
        void refreshDashboard();
    }, delayMs);
}

function readTimelineFilter(): TimelineFilter {
    return {
        type: byId<HTMLSelectElement>('timeline-filter-type').value || 'all',
        accountId: byId<HTMLSelectElement>('timeline-filter-account').value || 'all',
        listName: byId<HTMLSelectElement>('timeline-filter-list').value || 'all',
    };
}

function renderTimelineSection(): void {
    const optionSets = timeline.getFilterValues();
    const entries = timeline.getEntries(currentFilter);
    renderTimeline(entries, optionSets);
}

function appendTimelineEvent(type: string, data: string): void {
    try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const payload = (parsed.payload ?? parsed) as Record<string, unknown>;
        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString();
        timeline.push(type, payload, timestamp);
    } catch {
        timeline.push(type, { raw: data }, new Date().toISOString());
    }
    renderTimelineSection();
}

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

function handleRealtimeEvent(eventName: string, data: string): void {
    appendTimelineEvent(eventName, data);
    scheduleRefresh(eventName === 'run.log' ? 350 : 200);
    if (NOTIFICATION_EVENTS.has(eventName)) {
        fireDesktopNotification(eventName, data);
    }
}

function scheduleReconnect(): void {
    reconnectAttempts += 1;
    updateSseIndicator('DISCONNECTED');
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
            updateSseIndicator('CONNECTED');
        };

        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data as string) as { type?: string; payload?: Record<string, unknown> };
                if (msg.type && msg.type !== 'heartbeat' && TRACKED_EVENTS.includes(msg.type)) {
                    handleRealtimeEvent(msg.type, evt.data as string);
                }
            } catch {
                // ignore malformed messages
            }
        };

        ws.onclose = () => {
            wsConnection = null;
            scheduleReconnect();
        };

        ws.onerror = () => {
            ws.close();
        };

        return true;
    } catch {
        return false;
    }
}

function connectSseFallback(): void {
    eventSource = new EventSource('/api/events');

    TRACKED_EVENTS.forEach((eventName) => {
        eventSource?.addEventListener(eventName, (evt: MessageEvent<string>) => {
            handleRealtimeEvent(eventName, evt.data);
        });
    });

    eventSource.onopen = () => {
        reconnectAttempts = 0;
        updateSseIndicator('CONNECTED');
    };

    eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        scheduleReconnect();
    };
}

function connectEventStream(): void {
    // Cleanup existing connections
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
    }

    // Try WebSocket first, fall back to SSE
    if (!connectWebSocket()) {
        connectSseFallback();
    }
}

function startPolling(): void {
    if (pollTimer) {
        window.clearInterval(pollTimer);
    }
    pollTimer = window.setInterval(() => {
        void refreshDashboard();
    }, POLL_INTERVAL_MS);
}

function stopRealtime(): void {
    if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
    }
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    updateSseIndicator('UNKNOWN');
}

async function refreshDashboard(): Promise<void> {
    try {
        const snapshot = await api.loadSnapshot();

        renderKpis(snapshot.kpis);
        lastTrendData = snapshot.trend;
        renderKpiComparison(snapshot.trend);
        renderInvitesChart(snapshot.trend);
        const riskScore = snapshot.kpis.risk?.score ?? 0;
        renderRiskGauge(riskScore, 100 - riskScore);
        renderPredictiveRisk(snapshot.predictive);
        renderOperationalSlo(snapshot.observability.slo);
        renderSelectorCacheKpi(snapshot.observability.selectorCacheKpi);
        renderReviewQueue(snapshot.reviewQueue);
        renderCommentSuggestions(snapshot.commentSuggestions);
        renderRuns(snapshot.runs);
        renderAbLeaderboard(snapshot.ab);
        renderTimingSlots(snapshot.timingSlots);
        renderIncidents(snapshot.incidents, selectedIncidentIds);

        const queueCount = snapshot.reviewQueue.reviewLeadCount ?? 0;
        const incidentCount = snapshot.reviewQueue.challengeIncidentCount ?? 0;
        setText('ops-priority-summary', `Review lead: ${queueCount} · Challenge incidenti: ${incidentCount}`);

        setText('last-refresh', `Ultimo aggiornamento: ${new Date().toLocaleTimeString('it-IT', { hour12: false })}`);
    } catch (error) {
        setText('last-refresh', 'Ultimo aggiornamento: errore refresh');
        console.error('Errore refresh dashboard', error);
    }
}

function setStatusMessage(message: string): void {
    setText('action-feedback', message);
}

function setVoiceMessage(message: string): void {
    setText('voice-feedback', message);
}

function setVoiceFeedbackVisible(visible: boolean): void {
    const wrap = document.getElementById('voice-feedback-wrap');
    const mic = document.getElementById('voice-mic-indicator');
    if (wrap) wrap.hidden = !visible;
    if (mic) mic.classList.toggle('listening', visible);
}

function setVoiceButtonState(listening: boolean): void {
    const voiceButton = byId<HTMLButtonElement>('btn-voice');
    voiceButton.classList.remove('btn-secondary', 'btn-danger');
    if (listening) {
        voiceButton.classList.add('btn-danger');
        voiceButton.textContent = 'Stop Voce';
        voiceButton.setAttribute('aria-pressed', 'true');
        return;
    }
    voiceButton.classList.add('btn-secondary');
    voiceButton.textContent = 'Comando Voce';
    voiceButton.setAttribute('aria-pressed', 'false');
}

function readTranscriptFromSpeechEvent(event: SpeechRecognitionEventLike): string {
    const chunks: string[] = [];
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result || !result[0]) continue;
        if (result.isFinal) {
            chunks.push(result[0].transcript);
        }
    }
    return chunks.join(' ').trim();
}

function showVoiceConfirmDialog(transcript: string, action: DashboardVoiceAction): void {
    setText('voice-transcript-text', transcript);
    setText('voice-action-summary', describeVoiceAction(action));
    byId<HTMLDialogElement>('voice-command-modal').showModal();
}

function clearVoiceConfirmDialog(): void {
    pendingVoiceAction = null;
    byId<HTMLDialogElement>('voice-command-modal').close();
}

async function resolveSelectedIncidents(): Promise<{ resolved: number; total: number }> {
    const total = selectedIncidentIds.size;
    if (total === 0) {
        return { resolved: 0, total: 0 };
    }

    let resolved = 0;
    for (const incidentId of Array.from(selectedIncidentIds)) {
        const ok = await api.resolveIncident(incidentId);
        if (!ok) continue;
        resolved += 1;
        selectedIncidentIds.delete(incidentId);
    }
    return { resolved, total };
}

async function executeVoiceAction(action: DashboardVoiceAction): Promise<void> {
    if (action.kind === 'refresh') {
        await refreshDashboard();
        setStatusMessage('Dashboard aggiornata (voce)');
        setVoiceMessage('Comando vocale eseguito: aggiorna');
        return;
    }

    if (action.kind === 'pause') {
        const ok = await api.pause(action.minutes);
        setStatusMessage(ok ? `Pausa attivata per ${action.minutes} minuti` : 'Errore durante la pausa');
        setVoiceMessage(ok ? 'Comando vocale eseguito: pausa' : 'Comando vocale fallito: pausa');
        if (ok) {
            await refreshDashboard();
        }
        return;
    }

    if (action.kind === 'resume') {
        const ok = await api.resume();
        setStatusMessage(ok ? 'Automazione ripresa' : 'Errore durante la ripresa');
        setVoiceMessage(ok ? 'Comando vocale eseguito: riprendi' : 'Comando vocale fallito: riprendi');
        if (ok) {
            await refreshDashboard();
        }
        return;
    }

    if (action.kind === 'trigger_run') {
        const ok = await api.triggerRun(action.workflow);
        setStatusMessage(ok ? `Run "${action.workflow}" schedulato` : 'Errore trigger run');
        setVoiceMessage(ok ? `Comando vocale eseguito: avvia run ${action.workflow}` : 'Comando vocale fallito: trigger run');
        return;
    }

    if (action.kind === 'export_csv') {
        document.getElementById('btn-export-csv')?.click();
        setVoiceMessage('Comando vocale eseguito: esporta CSV');
        return;
    }

    if (action.kind === 'toggle_theme') {
        document.getElementById('btn-theme-toggle')?.click();
        setVoiceMessage('Comando vocale eseguito: cambia tema');
        return;
    }

    if (action.kind === 'print_report') {
        printReport();
        setVoiceMessage('Comando vocale eseguito: stampa report');
        return;
    }

    const report = await resolveSelectedIncidents();
    if (report.total === 0) {
        setStatusMessage('Nessun incidente selezionato');
        setVoiceMessage('Comando vocale annullato: nessun incidente selezionato');
        return;
    }
    setStatusMessage(`Incidenti risolti: ${report.resolved}/${report.total}`);
    setVoiceMessage(`Comando vocale eseguito: risolti ${report.resolved}/${report.total}`);
    await refreshDashboard();
}

async function handleVoiceTranscript(transcript: string): Promise<void> {
    if (!transcript.trim()) {
        setVoiceMessage('Nessun testo riconosciuto');
        return;
    }

    const action = parseVoiceCommand(transcript);
    if (!action) {
        setVoiceMessage(`Comando non riconosciuto: "${transcript}"`);
        return;
    }

    if (isCriticalVoiceAction(action)) {
        pendingVoiceAction = action;
        showVoiceConfirmDialog(transcript, action);
        setVoiceMessage(`Conferma richiesta: ${describeVoiceAction(action)}`);
        return;
    }

    await executeVoiceAction(action);
}

function bindVoiceControls(): void {
    const voiceButton = byId<HTMLButtonElement>('btn-voice');
    const modal = byId<HTMLDialogElement>('voice-command-modal');
    const cancelBtn = byId<HTMLButtonElement>('voice-cancel-btn');
    const confirmBtn = byId<HTMLButtonElement>('voice-confirm-btn');

    cancelBtn.addEventListener('click', () => {
        clearVoiceConfirmDialog();
        setVoiceMessage('Conferma comando vocale annullata');
    });

    modal.addEventListener('close', () => {
        pendingVoiceAction = null;
    });

    confirmBtn.addEventListener('click', () => {
        const action = pendingVoiceAction;
        clearVoiceConfirmDialog();
        if (!action) {
            setVoiceMessage('Nessun comando vocale da confermare');
            return;
        }
        void executeVoiceAction(action);
    });

    const speechWindow = window as WindowWithSpeechRecognition;
    const RecognitionCtor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!RecognitionCtor) {
        voiceButton.disabled = true;
        voiceButton.title = 'Web Speech API non disponibile in questo browser';
        setVoiceMessage('Comandi vocali non disponibili su questo browser');
        return;
    }

    const recognition = new RecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = SPEECH_RECOGNITION_LANG;

    recognition.onstart = () => {
        isVoiceListening = true;
        setVoiceButtonState(true);
        setVoiceMessage('Ascolto in corso...');
        setVoiceFeedbackVisible(true);
    };

    recognition.onend = () => {
        isVoiceListening = false;
        setVoiceButtonState(false);
        setVoiceFeedbackVisible(false);
        setText('voice-partial-transcript', '');
    };

    recognition.onerror = (event) => {
        const errorCode = event.error ?? 'unknown';
        setVoiceMessage(`Errore riconoscimento vocale: ${errorCode}`);
        setVoiceFeedbackVisible(false);
    };

    recognition.onresult = (event) => {
        // Show interim (partial) transcript in real-time
        const partials: string[] = [];
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (!result || !result[0]) continue;
            if (!result.isFinal) {
                partials.push(result[0].transcript);
            }
        }
        if (partials.length > 0) {
            setText('voice-partial-transcript', partials.join(' '));
        }

        const transcript = readTranscriptFromSpeechEvent(event);
        if (transcript) {
            setText('voice-partial-transcript', '');
            void handleVoiceTranscript(transcript);
        }
    };

    voiceRecognition = recognition;
    setVoiceButtonState(false);

    voiceButton.addEventListener('click', () => {
        if (!voiceRecognition) {
            setVoiceMessage('Riconoscimento vocale non inizializzato');
            return;
        }
        if (isVoiceListening) {
            voiceRecognition.stop();
            return;
        }
        try {
            voiceRecognition.start();
        } catch {
            setVoiceMessage('Impossibile avviare il microfono in questo momento');
        }
    });
}

// ─── Keyboard Shortcuts ──────────────────────────────────────────────────────

function bindKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        // Ignore when typing in inputs/textareas
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        // Ignore if modifier keys are held (except shift for ?)
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        switch (e.key) {
            case '?':
                e.preventDefault();
                toggleShortcutHelp();
                break;
            case 'r':
                e.preventDefault();
                api.forceRefresh();
                void refreshDashboard();
                setStatusMessage('Dashboard aggiornata (shortcut R)');
                break;
            case 'd':
                e.preventDefault();
                currentTheme = cycleTheme(currentTheme);
                applyTheme(currentTheme);
                saveUiPrefs({ filter: currentFilter, theme: currentTheme });
                break;
            case 'Escape': {
                // Close any open modal/dialog
                const openDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
                openDialogs.forEach((d) => d.close());
                // Close shortcut help if open
                const helpEl = document.getElementById('shortcut-help-overlay');
                if (helpEl && !helpEl.hidden) helpEl.hidden = true;
                break;
            }
            case 'e':
                e.preventDefault();
                document.getElementById('btn-export-csv')?.click();
                break;
            case 'p':
                e.preventDefault();
                printReport();
                break;
        }
    });
}

function toggleShortcutHelp(): void {
    let overlay = document.getElementById('shortcut-help-overlay');
    if (overlay) {
        overlay.hidden = !overlay.hidden;
        return;
    }
    // Create overlay on first use
    overlay = document.createElement('div');
    overlay.id = 'shortcut-help-overlay';
    overlay.className = 'shortcut-help-overlay';
    overlay.innerHTML = `
        <div class="shortcut-help-card">
            <h3>Scorciatoie tastiera</h3>
            <table>
                <tr><td><kbd>?</kbd></td><td>Mostra/nascondi questo help</td></tr>
                <tr><td><kbd>R</kbd></td><td>Aggiorna dashboard</td></tr>
                <tr><td><kbd>D</kbd></td><td>Cambia tema (auto/dark/light)</td></tr>
                <tr><td><kbd>E</kbd></td><td>Esporta CSV</td></tr>
                <tr><td><kbd>P</kbd></td><td>Stampa report</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Chiudi modale/overlay</td></tr>
            </table>
            <p class="shortcut-help-footer">Premi <kbd>?</kbd> o <kbd>Esc</kbd> per chiudere</p>
        </div>`;
    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay && overlay) overlay.hidden = true;
    });
    document.body.appendChild(overlay);
}

function bindLeadSearch(): void {
    function doSearch(page: number = 1): void {
        const query = (document.getElementById('lead-search-input') as HTMLInputElement)?.value ?? '';
        const status = (document.getElementById('lead-search-status') as HTMLSelectElement)?.value ?? '';

        // Hide detail panel when starting a new search
        const detailEl = document.getElementById('lead-detail-content');
        if (detailEl) detailEl.hidden = true;

        void api.searchLeads(query, status || undefined, undefined, page).then((result) => {
            renderLeadSearchResults(
                result.leads,
                result.total,
                result.page,
                result.pageSize,
                (p) => doSearch(p),
                (leadId) => {
                    void api.getLeadDetail(leadId).then((detail) => {
                        if (!detail) return;
                        const el = document.getElementById('lead-detail-content');
                        if (el) {
                            el.hidden = false;
                            renderLeadDetail(detail.lead, detail.timeline);
                        }
                    });
                },
            );
        }).catch(() => setStatusMessage('Errore ricerca lead'));
    }

    document.getElementById('btn-lead-search')?.addEventListener('click', () => doSearch(1));
    document.getElementById('lead-search-input')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') doSearch(1);
    });
}

function bindControls(): void {
    byId<HTMLButtonElement>('btn-refresh').addEventListener('click', () => {
        api.forceRefresh();
        void refreshDashboard();
    });

    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
        currentTheme = cycleTheme(currentTheme);
        applyTheme(currentTheme);
        saveUiPrefs({ filter: currentFilter, theme: currentTheme });
    });

    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
        if (lastTrendData.length === 0) {
            setStatusMessage('Nessun dato trend da esportare');
            return;
        }
        const rows = lastTrendData.map((r) => ({
            date: r.date,
            invites_sent: r.invitesSent,
            messages_sent: r.messagesSent,
            acceptances: r.acceptances,
            run_errors: r.runErrors,
            challenges: r.challenges,
            risk_score: Math.round(r.estimatedRiskScore ?? 0),
        }));
        const dateStr = new Date().toISOString().slice(0, 10);
        exportToCSV(rows, `linkedin-bot-trend-${dateStr}.csv`);
        setStatusMessage('Trend CSV esportato');
    });

    document.getElementById('btn-export-chart')?.addEventListener('click', () => {
        const dateStr = new Date().toISOString().slice(0, 10);
        downloadCanvasAsPng('chart-invites-daily', `linkedin-bot-chart-${dateStr}.png`);
        setStatusMessage('Grafico PNG scaricato');
    });

    document.getElementById('btn-print')?.addEventListener('click', () => {
        printReport();
    });

    document.getElementById('sse-reconnect')?.addEventListener('click', () => {
        updateSseIndicator('UNKNOWN');
        connectEventStream();
    });

    byId<HTMLButtonElement>('btn-pause').addEventListener('click', () => {
        byId<HTMLDialogElement>('pause-modal').showModal();
        byId<HTMLInputElement>('pause-minutes-input').focus();
    });

    byId<HTMLButtonElement>('pause-cancel-btn').addEventListener('click', () => {
        byId<HTMLDialogElement>('pause-modal').close();
    });

    byId<HTMLButtonElement>('pause-confirm-btn').addEventListener('click', () => {
        const input = byId<HTMLInputElement>('pause-minutes-input');
        const minutes = Number.parseInt(input.value, 10);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) {
            input.setCustomValidity('Inserisci un numero tra 1 e 10080');
            input.reportValidity();
            return;
        }
        input.setCustomValidity('');

        void api.pause(minutes).then((ok) => {
            setStatusMessage(ok ? `Pausa attivata per ${minutes} minuti` : 'Errore durante la pausa');
            if (ok) {
                byId<HTMLDialogElement>('pause-modal').close();
                void refreshDashboard();
            }
        }).catch(() => setStatusMessage('Errore di rete durante la pausa'));
    });

    byId<HTMLButtonElement>('btn-resume').addEventListener('click', () => {
        void api.resume().then((ok) => {
            setStatusMessage(ok ? 'Automazione ripresa' : 'Errore durante la ripresa');
            if (ok) {
                void refreshDashboard();
            }
        }).catch(() => setStatusMessage('Errore di rete durante la ripresa'));
    });

    document.getElementById('btn-trigger-run')?.addEventListener('click', () => {
        void api.triggerRun('all').then((ok) => {
            setStatusMessage(ok ? 'Run workflow "all" schedulato per il prossimo ciclo' : 'Errore trigger run');
        }).catch(() => setStatusMessage('Errore di rete trigger run'));
    });

    byId<HTMLButtonElement>('btn-resolve-selected').addEventListener('click', () => {
        void resolveSelectedIncidents().then((report) => {
            if (report.total === 0) {
                setStatusMessage('Nessun incidente selezionato');
                return;
            }
            setStatusMessage(`Incidenti risolti: ${report.resolved}/${report.total}`);
            void refreshDashboard();
        }).catch(() => setStatusMessage('Errore di rete durante la risoluzione'));
    });

    byId<HTMLTableSectionElement>('incidents-tbody').addEventListener('change', (event) => {
        const target = event.target as HTMLElement;
        if (!(target instanceof HTMLInputElement) || !target.classList.contains('incident-select')) {
            return;
        }
        const id = Number.parseInt(target.dataset.incidentId ?? '', 10);
        if (!Number.isFinite(id)) return;

        if (target.checked) {
            selectedIncidentIds.add(id);
        } else {
            selectedIncidentIds.delete(id);
        }
    });

    byId<HTMLTableSectionElement>('incidents-tbody').addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (!(target instanceof HTMLButtonElement) || !target.classList.contains('incident-resolve')) {
            return;
        }
        const id = Number.parseInt(target.dataset.incidentId ?? '', 10);
        if (!Number.isFinite(id)) return;

        void api.resolveIncident(id).then((ok) => {
            setStatusMessage(ok ? `Incidente #${id} risolto` : `Errore risoluzione #${id}`);
            if (ok) {
                selectedIncidentIds.delete(id);
                void refreshDashboard();
            }
        }).catch(() => setStatusMessage(`Errore di rete risoluzione #${id}`));
    });

    byId<HTMLTableSectionElement>('comment-suggestions-tbody').addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }
        const leadId = Number.parseInt(target.dataset.leadId ?? '', 10);
        const suggestionIndex = Number.parseInt(target.dataset.suggestionIndex ?? '', 10);
        if (!Number.isFinite(leadId) || !Number.isFinite(suggestionIndex)) {
            return;
        }

        if (target.classList.contains('comment-suggestion-approve')) {
            const row = target.closest('tr');
            const editor = row?.querySelector<HTMLTextAreaElement>('textarea.comment-suggestion-editor');
            const comment = editor?.value ?? '';
            void api.approveCommentSuggestion(leadId, suggestionIndex, comment).then((ok) => {
                setStatusMessage(ok ? `Bozza approvata (lead #${leadId})` : `Errore approvazione bozza (lead #${leadId})`);
                if (ok) {
                    void refreshDashboard();
                }
            }).catch(() => setStatusMessage(`Errore di rete approvazione bozza (lead #${leadId})`));
            return;
        }

        if (target.classList.contains('comment-suggestion-reject')) {
            void api.rejectCommentSuggestion(leadId, suggestionIndex).then((ok) => {
                setStatusMessage(ok ? `Bozza rifiutata (lead #${leadId})` : `Errore rifiuto bozza (lead #${leadId})`);
                if (ok) {
                    void refreshDashboard();
                }
            }).catch(() => setStatusMessage(`Errore di rete rifiuto bozza (lead #${leadId})`));
        }
    });

    ['timeline-filter-type', 'timeline-filter-account', 'timeline-filter-list'].forEach((id) => {
        byId<HTMLSelectElement>(id).addEventListener('change', () => {
            currentFilter = readTimelineFilter();
            saveUiPrefs({ filter: currentFilter, theme: currentTheme });
            renderTimelineSection();
        });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopRealtime();
            return;
        }
        void refreshDashboard();
        startPolling();
        connectEventStream();
    });

    bindLeadSearch();
    bindVoiceControls();
    bindKeyboardShortcuts();
}

function restoreFilterSelects(): void {
    const selects: Array<[string, keyof TimelineFilter]> = [
        ['timeline-filter-type', 'type'],
        ['timeline-filter-account', 'accountId'],
        ['timeline-filter-list', 'listName'],
    ];
    for (const [id, key] of selects) {
        const el = document.getElementById(id) as HTMLSelectElement | null;
        if (el && currentFilter[key] !== 'all') {
            el.value = currentFilter[key];
        }
    }
}

function registerServiceWorker(): void {
    if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.register('/sw.js').catch(() => {
            // SW registration failed — offline caching unavailable
        });
    }
}

async function bootstrap(): Promise<void> {
    bindControls();
    requestNotificationPermission();
    registerServiceWorker();
    await api.bootstrapSessionFromUrl();
    await refreshDashboard();
    restoreFilterSelects();
    renderTimelineSection();
    startPolling();
    connectEventStream();
}

void bootstrap();
