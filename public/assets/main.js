import { DashboardApi } from './apiClient';
import { byId, setText } from './dom';
import { renderAbLeaderboard, renderIncidents, renderKpiComparison, renderKpis, renderPredictiveRisk, renderReviewQueue, renderRuns, renderTimeline, renderTimingSlots, } from './renderers';
import { TimelineStore } from './timeline';
const POLL_INTERVAL_MS = 20_000;
const SSE_RECONNECT_BASE_MS = 2_000;
const api = new DashboardApi();
const timeline = new TimelineStore();
const selectedIncidentIds = new Set();
let eventSource = null;
let pollTimer = null;
let refreshTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let currentFilter = { type: 'all', accountId: 'all', listName: 'all' };
function scheduleRefresh(delayMs = 250) {
    if (refreshTimer) {
        window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
        void refreshDashboard();
    }, delayMs);
}
function readTimelineFilter() {
    return {
        type: byId('timeline-filter-type').value || 'all',
        accountId: byId('timeline-filter-account').value || 'all',
        listName: byId('timeline-filter-list').value || 'all',
    };
}
function renderTimelineSection() {
    const optionSets = timeline.getFilterValues();
    const entries = timeline.getEntries(currentFilter);
    renderTimeline(entries, optionSets);
}
function appendTimelineEvent(type, data) {
    try {
        const parsed = JSON.parse(data);
        const payload = (parsed.payload ?? parsed);
        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString();
        timeline.push(type, payload, timestamp);
    }
    catch {
        timeline.push(type, { raw: data }, new Date().toISOString());
    }
    renderTimelineSection();
}
function connectEventStream() {
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
        eventSource?.addEventListener(eventName, (evt) => {
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
function startPolling() {
    if (pollTimer) {
        window.clearInterval(pollTimer);
    }
    pollTimer = window.setInterval(() => {
        void refreshDashboard();
    }, POLL_INTERVAL_MS);
}
function stopRealtime() {
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
async function refreshDashboard() {
    try {
        const snapshot = await api.loadSnapshot();
        renderKpis(snapshot.kpis);
        renderKpiComparison(snapshot.trend);
        renderPredictiveRisk(snapshot.predictive);
        renderReviewQueue(snapshot.reviewQueue);
        renderRuns(snapshot.runs);
        renderAbLeaderboard(snapshot.ab);
        renderTimingSlots(snapshot.timingSlots);
        renderIncidents(snapshot.incidents, selectedIncidentIds);
        const queueCount = snapshot.reviewQueue.reviewLeadCount ?? 0;
        const incidentCount = snapshot.reviewQueue.challengeIncidentCount ?? 0;
        setText('ops-priority-summary', `Review lead: ${queueCount} · Challenge incidenti: ${incidentCount}`);
        setText('last-refresh', `Ultimo aggiornamento: ${new Date().toLocaleTimeString('it-IT', { hour12: false })}`);
    }
    catch (error) {
        setText('last-refresh', 'Ultimo aggiornamento: errore refresh');
        console.error('Errore refresh dashboard', error);
    }
}
function setStatusMessage(message) {
    setText('action-feedback', message);
}
function bindControls() {
    byId('btn-refresh').addEventListener('click', () => {
        void refreshDashboard();
    });
    byId('btn-pause').addEventListener('click', () => {
        byId('pause-modal').showModal();
        byId('pause-minutes-input').focus();
    });
    byId('pause-cancel-btn').addEventListener('click', () => {
        byId('pause-modal').close();
    });
    byId('pause-confirm-btn').addEventListener('click', async () => {
        const input = byId('pause-minutes-input');
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
            byId('pause-modal').close();
            await refreshDashboard();
        }
    });
    byId('btn-resume').addEventListener('click', async () => {
        const ok = await api.resume();
        setStatusMessage(ok ? 'Automazione ripresa' : 'Errore durante la ripresa');
        if (ok) {
            await refreshDashboard();
        }
    });
    byId('btn-resolve-selected').addEventListener('click', async () => {
        if (selectedIncidentIds.size === 0) {
            setStatusMessage('Nessun incidente selezionato');
            return;
        }
        let resolved = 0;
        for (const incidentId of Array.from(selectedIncidentIds)) {
            const ok = await api.resolveIncident(incidentId);
            if (ok) {
                resolved += 1;
                selectedIncidentIds.delete(incidentId);
            }
        }
        setStatusMessage(`Incidenti risolti: ${resolved}/${resolved + selectedIncidentIds.size}`);
        await refreshDashboard();
    });
    byId('incidents-tbody').addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.classList.contains('incident-select')) {
            return;
        }
        const id = Number.parseInt(target.dataset.incidentId ?? '', 10);
        if (!Number.isFinite(id))
            return;
        if (target.checked) {
            selectedIncidentIds.add(id);
        }
        else {
            selectedIncidentIds.delete(id);
        }
    });
    byId('incidents-tbody').addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || !target.classList.contains('incident-resolve')) {
            return;
        }
        const id = Number.parseInt(target.dataset.incidentId ?? '', 10);
        if (!Number.isFinite(id))
            return;
        const ok = await api.resolveIncident(id);
        setStatusMessage(ok ? `Incidente #${id} risolto` : `Errore risoluzione #${id}`);
        if (ok) {
            selectedIncidentIds.delete(id);
            await refreshDashboard();
        }
    });
    ['timeline-filter-type', 'timeline-filter-account', 'timeline-filter-list'].forEach((id) => {
        byId(id).addEventListener('change', () => {
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
}
async function bootstrap() {
    bindControls();
    await api.bootstrapSessionFromUrl();
    await refreshDashboard();
    renderTimelineSection();
    startPolling();
    connectEventStream();
}
void bootstrap();
