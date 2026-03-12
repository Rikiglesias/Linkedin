import { DashboardApi } from './apiClient';
import { renderInvitesChart, renderRiskGauge } from './charts';
import { byId, setText, exportToCSV, downloadCanvasAsPng, printReport, showToast } from './dom';
import {
    renderAbLeaderboard,
    renderCommentSuggestions,
    renderIncidents,
    renderKpiComparison,
    renderKpis,
    renderOperationalSlo,
    renderPredictiveRisk,
    renderProxyHealth,
    renderSessionTimer,
    renderReviewQueue,
    renderRuns,
    renderSelectorCacheKpi,
    renderTimeline,
    renderTimingSlots,
} from './renderers';
import { TimelineStore } from './timeline';
import { TimelineFilter, TrendRow } from './types';
import {
    initRealtime,
    connectEventStream,
    disconnectEventStream,
    isNotificationEvent,
} from './realtime';
import { updateSseIndicator, requestNotificationPermission, fireDesktopNotification } from './sseUi';
import { bindLeadSearch, bindBlacklist } from './leadSearch';

const POLL_INTERVAL_MS = 20_000;

const api = new DashboardApi();
const timeline = new TimelineStore();
const selectedIncidentIds = new Set<number>();
let lastTrendData: TrendRow[] = [];

let lastAuthErrorToastAt = 0;
api.onAuthError((status, path) => {
    console.warn(`[Dashboard] Auth error ${status} on ${path}`);
    const now = Date.now();
    if (now - lastAuthErrorToastAt > 10_000) {
        lastAuthErrorToastAt = now;
        showToast(`Sessione scaduta (${status}) — ricarica la pagina o ri-autentica`, 'error', 8000);
    }
});

api.onFetchStateChange((state) => {
    const indicator = document.getElementById('fetch-state-indicator');
    if (!indicator) return;
    indicator.classList.remove('fetch-idle', 'fetch-loading', 'fetch-success', 'fetch-error');
    indicator.classList.add(`fetch-${state}`);
    if (state === 'loading') {
        document.querySelectorAll('.kpi-value').forEach((el) => {
            if (el.textContent === '0' || el.textContent === '—') {
                el.classList.add('shimmer');
            }
        });
    } else {
        document.querySelectorAll('.shimmer').forEach((el) => el.classList.remove('shimmer'));
    }
});

let pollTimer: number | null = null;
let refreshTimer: number | null = null;
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

// ─── Realtime bridge: collega realtime.ts alle funzioni locali di main.ts ────
initRealtime({
    onStateChange: updateSseIndicator,
    onRealtimeEvent: (eventName: string, data: string) => {
        appendTimelineEvent(eventName, data);
        scheduleRefresh(eventName === 'run.log' ? 350 : 200);
        if (isNotificationEvent(eventName)) {
            fireDesktopNotification(eventName, data);
        }
    },
});

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
    disconnectEventStream();
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
        renderProxyHealth(snapshot.observability.proxyPool);
        renderSessionTimer(snapshot.observability.browserSessionStartedAt);
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
        showToast('Trend CSV esportato', 'success', 3000);
    });

    document.getElementById('btn-export-chart')?.addEventListener('click', () => {
        const dateStr = new Date().toISOString().slice(0, 10);
        downloadCanvasAsPng('chart-invites-daily', `linkedin-bot-chart-${dateStr}.png`);
        showToast('Grafico PNG scaricato', 'success', 3000);
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
            if (ok) {
                showToast(`Pausa attivata per ${minutes} minuti`, 'success');
                byId<HTMLDialogElement>('pause-modal').close();
                void refreshDashboard();
            } else {
                showToast('Errore durante la pausa', 'error');
            }
        }).catch(() => showToast('Errore di rete durante la pausa', 'error'));
    });

    byId<HTMLButtonElement>('btn-resume').addEventListener('click', () => {
        void api.resume().then((ok) => {
            if (ok) {
                showToast('Automazione ripresa', 'success');
                void refreshDashboard();
            } else {
                showToast('Errore durante la ripresa', 'error');
            }
        }).catch(() => showToast('Errore di rete durante la ripresa', 'error'));
    });

    document.getElementById('btn-trigger-run')?.addEventListener('click', () => {
        void api.triggerRun('all').then((ok) => {
            showToast(ok ? 'Run workflow "all" schedulato' : 'Errore trigger run', ok ? 'success' : 'error');
        }).catch(() => showToast('Errore di rete trigger run', 'error'));
    });

    byId<HTMLButtonElement>('btn-resolve-selected').addEventListener('click', () => {
        void resolveSelectedIncidents().then((report) => {
            if (report.total === 0) {
                showToast('Nessun incidente selezionato', 'warning');
                return;
            }
            showToast(`Incidenti risolti: ${report.resolved}/${report.total}`, 'success');
            void refreshDashboard();
        }).catch(() => showToast('Errore di rete durante la risoluzione', 'error'));
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

        if (!confirm(`Risolvere incidente #${id}? Questa azione non è reversibile.`)) return;
        void api.resolveIncident(id).then((ok) => {
            if (ok) {
                showToast(`Incidente #${id} risolto`, 'success');
                selectedIncidentIds.delete(id);
                void refreshDashboard();
            } else {
                showToast(`Errore risoluzione #${id}`, 'error');
            }
        }).catch(() => showToast(`Errore di rete risoluzione #${id}`, 'error'));
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
                showToast(ok ? `Bozza approvata (lead #${leadId})` : `Errore approvazione bozza (lead #${leadId})`, ok ? 'success' : 'error');
                if (ok) {
                    void refreshDashboard();
                }
            }).catch(() => showToast(`Errore di rete approvazione bozza (lead #${leadId})`, 'error'));
            return;
        }

        if (target.classList.contains('comment-suggestion-reject')) {
            void api.rejectCommentSuggestion(leadId, suggestionIndex).then((ok) => {
                showToast(ok ? `Bozza rifiutata (lead #${leadId})` : `Errore rifiuto bozza (lead #${leadId})`, ok ? 'success' : 'error');
                if (ok) {
                    void refreshDashboard();
                }
            }).catch(() => showToast(`Errore di rete rifiuto bozza (lead #${leadId})`, 'error'));
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

    bindLeadSearch(api);
    bindBlacklist(api);
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

function bindLoginForm(): void {
    const modal = document.getElementById('login-modal') as HTMLDialogElement | null;
    const form = document.getElementById('login-form') as HTMLFormElement | null;
    const apiKeyInput = document.getElementById('login-api-key') as HTMLInputElement | null;
    const totpInput = document.getElementById('login-totp') as HTMLInputElement | null;
    const errorEl = document.getElementById('login-error') as HTMLParagraphElement | null;
    const submitBtn = document.getElementById('login-submit-btn') as HTMLButtonElement | null;
    if (!modal || !form || !apiKeyInput) return;

    form.addEventListener('submit', (e) => { void (async () => {
        e.preventDefault();
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) return;
        const totpCode = totpInput?.value.trim() || undefined;

        if (submitBtn) submitBtn.disabled = true;
        if (errorEl) errorEl.hidden = true;

        const result = await api.loginWithCredentials(apiKey, totpCode);

        if (result.success) {
            modal.close();
            apiKeyInput.value = '';
            if (totpInput) totpInput.value = '';
            await refreshDashboard();
            startPolling();
            connectEventStream();
            return;
        }

        if (result.totpRequired && totpInput) {
            totpInput.parentElement?.querySelector('label')?.classList.add('required');
            totpInput.focus();
        }

        if (errorEl && result.error) {
            errorEl.textContent = result.error;
            errorEl.hidden = false;
        }
        if (submitBtn) submitBtn.disabled = false;
    })(); });
}

async function bootstrap(): Promise<void> {
    bindControls();
    bindLoginForm();
    requestNotificationPermission();
    registerServiceWorker();

    // Prova bootstrap da URL (retrocompatibile)
    await api.bootstrapSessionFromUrl();

    // Se auth abilitata e nessuna sessione valida → mostra form login
    const hasSession = await api.hasValidSession();
    if (!hasSession) {
        const modal = document.getElementById('login-modal') as HTMLDialogElement | null;
        if (modal?.showModal) {
            modal.showModal();
            return; // Il form login chiamerà refreshDashboard dopo il successo
        }
    }

    await refreshDashboard();
    restoreFilterSelects();
    renderTimelineSection();
    startPolling();
    connectEventStream();
}

void bootstrap();
