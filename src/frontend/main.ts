import { DashboardApi } from './apiClient';
import { byId, setText } from './dom';
import {
    renderAbLeaderboard,
    renderCommentSuggestions,
    renderIncidents,
    renderKpiComparison,
    renderKpis,
    renderOperationalSlo,
    renderPredictiveRisk,
    renderReviewQueue,
    renderRuns,
    renderSelectorCacheKpi,
    renderTimeline,
    renderTimingSlots,
} from './renderers';
import { TimelineStore } from './timeline';
import { TimelineFilter } from './types';
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

let eventSource: EventSource | null = null;
let pollTimer: number | null = null;
let refreshTimer: number | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;
let currentFilter: TimelineFilter = { type: 'all', accountId: 'all', listName: 'all' };
let voiceRecognition: SpeechRecognitionLike | null = null;
let isVoiceListening = false;
let pendingVoiceAction: DashboardVoiceAction | null = null;

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

function connectEventStream(): void {
    if (eventSource) {
        eventSource.close();
    }
    if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
    }

    eventSource = new EventSource('/api/events');

    const trackedEvents = [
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

    trackedEvents.forEach((eventName) => {
        eventSource?.addEventListener(eventName, (evt: MessageEvent<string>) => {
            appendTimelineEvent(eventName, evt.data);
            scheduleRefresh(eventName === 'run.log' ? 350 : 200);
        });
    });

    eventSource.onopen = () => {
        reconnectAttempts = 0;
    };

    eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        reconnectAttempts += 1;
        const delay = Math.min(30_000, SSE_RECONNECT_BASE_MS * Math.pow(2, Math.min(6, reconnectAttempts)));
        reconnectTimer = window.setTimeout(() => {
            if (!document.hidden) {
                connectEventStream();
            }
        }, delay);
    };
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
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

async function refreshDashboard(): Promise<void> {
    try {
        const snapshot = await api.loadSnapshot();

        renderKpis(snapshot.kpis);
        renderKpiComparison(snapshot.trend);
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
    recognition.interimResults = false;
    recognition.lang = SPEECH_RECOGNITION_LANG;

    recognition.onstart = () => {
        isVoiceListening = true;
        setVoiceButtonState(true);
        setVoiceMessage('Ascolto in corso...');
    };

    recognition.onend = () => {
        isVoiceListening = false;
        setVoiceButtonState(false);
    };

    recognition.onerror = (event) => {
        const errorCode = event.error ?? 'unknown';
        setVoiceMessage(`Errore riconoscimento vocale: ${errorCode}`);
    };

    recognition.onresult = (event) => {
        const transcript = readTranscriptFromSpeechEvent(event);
        void handleVoiceTranscript(transcript);
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

function bindControls(): void {
    byId<HTMLButtonElement>('btn-refresh').addEventListener('click', () => {
        void refreshDashboard();
    });

    byId<HTMLButtonElement>('btn-pause').addEventListener('click', () => {
        byId<HTMLDialogElement>('pause-modal').showModal();
        byId<HTMLInputElement>('pause-minutes-input').focus();
    });

    byId<HTMLButtonElement>('pause-cancel-btn').addEventListener('click', () => {
        byId<HTMLDialogElement>('pause-modal').close();
    });

    byId<HTMLButtonElement>('pause-confirm-btn').addEventListener('click', async () => {
        const input = byId<HTMLInputElement>('pause-minutes-input');
        const minutes = Number.parseInt(input.value, 10);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) {
            input.setCustomValidity('Inserisci un numero tra 1 e 10080');
            input.reportValidity();
            return;
        }
        input.setCustomValidity('');

        const ok = await api.pause(minutes);
        setStatusMessage(ok ? `Pausa attivata per ${minutes} minuti` : 'Errore durante la pausa');
        if (ok) {
            byId<HTMLDialogElement>('pause-modal').close();
            await refreshDashboard();
        }
    });

    byId<HTMLButtonElement>('btn-resume').addEventListener('click', async () => {
        const ok = await api.resume();
        setStatusMessage(ok ? 'Automazione ripresa' : 'Errore durante la ripresa');
        if (ok) {
            await refreshDashboard();
        }
    });

    byId<HTMLButtonElement>('btn-resolve-selected').addEventListener('click', async () => {
        const report = await resolveSelectedIncidents();
        if (report.total === 0) {
            setStatusMessage('Nessun incidente selezionato');
            return;
        }
        setStatusMessage(`Incidenti risolti: ${report.resolved}/${report.total}`);
        await refreshDashboard();
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

    byId<HTMLTableSectionElement>('incidents-tbody').addEventListener('click', async (event) => {
        const target = event.target as HTMLElement;
        if (!(target instanceof HTMLButtonElement) || !target.classList.contains('incident-resolve')) {
            return;
        }
        const id = Number.parseInt(target.dataset.incidentId ?? '', 10);
        if (!Number.isFinite(id)) return;

        const ok = await api.resolveIncident(id);
        setStatusMessage(ok ? `Incidente #${id} risolto` : `Errore risoluzione #${id}`);
        if (ok) {
            selectedIncidentIds.delete(id);
            await refreshDashboard();
        }
    });

    byId<HTMLTableSectionElement>('comment-suggestions-tbody').addEventListener('click', async (event) => {
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
            const ok = await api.approveCommentSuggestion(leadId, suggestionIndex, comment);
            setStatusMessage(ok ? `Bozza approvata (lead #${leadId})` : `Errore approvazione bozza (lead #${leadId})`);
            if (ok) {
                await refreshDashboard();
            }
            return;
        }

        if (target.classList.contains('comment-suggestion-reject')) {
            const ok = await api.rejectCommentSuggestion(leadId, suggestionIndex);
            setStatusMessage(ok ? `Bozza rifiutata (lead #${leadId})` : `Errore rifiuto bozza (lead #${leadId})`);
            if (ok) {
                await refreshDashboard();
            }
        }
    });

    ['timeline-filter-type', 'timeline-filter-account', 'timeline-filter-list'].forEach((id) => {
        byId<HTMLSelectElement>(id).addEventListener('change', () => {
            currentFilter = readTimelineFilter();
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

    bindVoiceControls();
}

async function bootstrap(): Promise<void> {
    bindControls();
    await api.bootstrapSessionFromUrl();
    await refreshDashboard();
    renderTimelineSection();
    startPolling();
    connectEventStream();
}

void bootstrap();
