/* ═══════════════════════════════════════════════════════════════════
   LinkedIn Bot Dashboard — app.js
   Miglioramenti: escapeHtml, Visibility API pause, modale pause,
   grafico trend 7gg, tabella incidents con risoluzione inline.
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const POLL_INTERVAL_MS = 30_000;
const SSE_RECONNECT_BASE_MS = 2_000;
let pollInterval = null;
let funnelChart = null;
let trendChart = null;
let eventSource = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
let refreshTimer = null;

// ── Sicurezza: escapeHtml per prevenire XSS in innerHTML ─────────────────────
function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function formatDate(iso) {
    if (!iso || iso === 'null') return '—';
    try {
        return new Date(iso).toLocaleString('it-IT', { hour12: false });
    } catch {
        return escapeHtml(String(iso));
    }
}

function pct(num, den) {
    if (!den || den === 0) return '0.0%';
    return ((num / den) * 100).toFixed(1) + '%';
}

// ── Visibility API: sospende il polling quando la tab è nascosta ─────────────
function startPolling() {
    clearInterval(pollInterval);
    pollInterval = setInterval(loadData, POLL_INTERVAL_MS);
}

function stopPolling() {
    clearInterval(pollInterval);
    pollInterval = null;
}

function scheduleLoadData(delayMs = 250) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        loadData().catch((err) => console.error('Errore refresh pianificato:', err));
    }, delayMs);
}

function disconnectEventStream() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
}

function connectEventStream() {
    disconnectEventStream();
    eventSource = new EventSource('/api/events');

    const refreshOnEvent = () => scheduleLoadData(250);
    const events = [
        'connected',
        'lead.transition',
        'lead.reconciled',
        'incident.opened',
        'incident.resolved',
        'automation.paused',
        'automation.resumed',
        'system.quarantine',
    ];

    events.forEach((eventName) => {
        eventSource.addEventListener(eventName, refreshOnEvent);
    });

    eventSource.addEventListener('run.log', (evt) => {
        try {
            const parsed = JSON.parse(evt.data);
            const logEvent = parsed?.payload?.event;
            if (typeof logEvent === 'string') {
                const interesting = [
                    'job.started',
                    'job.failed',
                    'job.challenge_detected',
                    'follow_up.done',
                    'inbox.analyzed_message',
                ];
                if (interesting.some((token) => logEvent.includes(token))) {
                    scheduleLoadData(150);
                    return;
                }
            }
        } catch {
            // ignore parse errors and fallback to default refresh
        }
        scheduleLoadData(350);
    });

    eventSource.onerror = () => {
        disconnectEventStream();
        sseReconnectAttempts += 1;
        const delay = Math.min(30_000, SSE_RECONNECT_BASE_MS * Math.pow(2, Math.min(6, sseReconnectAttempts)));
        sseReconnectTimer = setTimeout(() => {
            if (!document.hidden) {
                connectEventStream();
            }
        }, delay);
    };

    eventSource.onopen = () => {
        sseReconnectAttempts = 0;
    };
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopPolling();
        disconnectEventStream();
    } else {
        loadData();   // Aggiorna subito quando torna visibile
        startPolling();
        connectEventStream();
    }
});

// ── Modale Pausa ─────────────────────────────────────────────────────────────
function openPauseModal() {
    const modal = document.getElementById('pause-modal');
    modal.showModal();
    document.getElementById('pause-minutes-input').focus();
}

async function confirmPause() {
    const input = document.getElementById('pause-minutes-input');
    const minutes = parseInt(input.value, 10);
    if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
        input.setCustomValidity('Inserisci un numero tra 1 e 10080');
        input.reportValidity();
        return;
    }
    input.setCustomValidity('');
    const btn = document.getElementById('pause-confirm-btn');
    btn.disabled = true;
    btn.textContent = '⏳ In corso...';
    try {
        const resp = await fetch('/api/controls/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutes }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        document.getElementById('pause-modal').close();
        await loadData();
    } catch (err) {
        console.error('Errore pausa:', err);
    } finally {
        btn.disabled = false;
        btn.textContent = '⏸ Conferma Pausa';
    }
}

// ── Controllo Riprendi ────────────────────────────────────────────────────────
async function controlResume() {
    const btn = document.getElementById('btn-resume');
    btn.disabled = true;
    try {
        await fetch('/api/controls/resume', { method: 'POST' });
        await loadData();
    } catch (err) {
        console.error('Errore resume:', err);
    } finally {
        btn.disabled = false;
    }
}

// ── Incident resolve ─────────────────────────────────────────────────────────
async function resolveIncident(id) {
    if (!confirm(`Risolvere incidente #${id}?`)) return;
    try {
        const resp = await fetch(`/api/incidents/${id}/resolve`, { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await loadIncidents();
    } catch (err) {
        console.error('Errore resolve incident:', err);
    }
}

// ── Aggiornamento Status Badge ────────────────────────────────────────────────
function updateStatusBadge(system) {
    const badge = document.getElementById('status-badge');
    const text = document.getElementById('status-text');
    badge.className = 'status-badge';
    if (system.quarantined) {
        badge.classList.add('status-quarantine');
        text.textContent = 'Quarantena';
    } else if (system.pausedUntil) {
        badge.classList.add('status-paused');
        const until = new Date(system.pausedUntil).toLocaleTimeString('it-IT', { hour12: false });
        text.textContent = `Pausato fino alle ${until}`;
    } else {
        badge.classList.add('status-running');
        text.textContent = 'In esecuzione';
    }
}

// ── Funnel Chart ─────────────────────────────────────────────────────────────
function updateFunnelChart(funnel) {
    const labels = ['Invitati', 'Accettati', 'Ready Msg', 'Messaggiati', 'Risposte'];
    const data = [funnel.invited, funnel.accepted, funnel.readyMessage, funnel.messaged, funnel.replied];

    if (!funnelChart) {
        const ctx = document.getElementById('funnelChart').getContext('2d');
        funnelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Lead',
                    data,
                    backgroundColor: [
                        'rgba(0, 119, 181, 0.7)',
                        'rgba(0, 212, 255, 0.7)',
                        'rgba(59, 130, 246, 0.7)',
                        'rgba(16, 185, 129, 0.7)',
                        'rgba(245, 158, 11, 0.7)',
                    ],
                    borderRadius: 6,
                    borderSkipped: false,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8896b0' } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8896b0' } },
                },
            },
        });
    } else {
        funnelChart.data.datasets[0].data = data;
        funnelChart.update('none');
    }
    document.getElementById('funnel-updated').textContent = `Tot: ${funnel.totalLeads.toLocaleString()} lead`;
}

// ── Trend 7 giorni Chart ──────────────────────────────────────────────────────
function updateTrendChart(trend) {
    const labels = trend.map((d) => d.date.slice(5)); // MM-DD
    const invites = trend.map((d) => d.invitesSent);
    const messages = trend.map((d) => d.messagesSent);
    const acceptances = trend.map((d) => d.acceptances);

    if (!trendChart) {
        const ctx = document.getElementById('trendChart').getContext('2d');
        trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Inviti',
                        data: invites,
                        borderColor: 'rgba(0, 119, 181, 0.9)',
                        backgroundColor: 'rgba(0, 119, 181, 0.1)',
                        tension: 0.3,
                        fill: true,
                    },
                    {
                        label: 'Messaggi',
                        data: messages,
                        borderColor: 'rgba(16, 185, 129, 0.9)',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.3,
                        fill: true,
                    },
                    {
                        label: 'Accettazioni',
                        data: acceptances,
                        borderColor: 'rgba(0, 212, 255, 0.9)',
                        backgroundColor: 'rgba(0, 212, 255, 0.1)',
                        tension: 0.3,
                        fill: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: { color: '#8896b0', boxWidth: 12, font: { size: 11 } },
                    },
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8896b0' } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8896b0' } },
                },
            },
        });
    } else {
        trendChart.data.labels = labels;
        trendChart.data.datasets[0].data = invites;
        trendChart.data.datasets[1].data = messages;
        trendChart.data.datasets[2].data = acceptances;
        trendChart.update('none');
    }
}

// ── Incidents Table ───────────────────────────────────────────────────────────
async function loadIncidents() {
    try {
        const resp = await fetch('/api/incidents');
        if (!resp.ok) return;
        const incidents = await resp.json();
        const tbody = document.getElementById('incidents-tbody');
        const count = document.getElementById('incidents-count');
        count.textContent = incidents.length === 0 ? 'Nessun incidente aperto' : `${incidents.length} aperti`;

        if (incidents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">✅ Nessun incidente aperto</td></tr>';
            return;
        }

        tbody.innerHTML = incidents.map((inc) => `
            <tr>
                <td>${escapeHtml(String(inc.id))}</td>
                <td><code>${escapeHtml(inc.type)}</code></td>
                <td><span class="pill ${inc.severity === 'CRITICAL' ? 'pill-danger' : inc.severity === 'WARN' ? 'pill-warning' : 'pill-info'}">${escapeHtml(inc.severity)}</span></td>
                <td>${formatDate(inc.opened_at)}</td>
                <td><button class="btn btn-sm btn-success" onclick="resolveIncident(${escapeHtml(String(inc.id))})">✓ Risolvi</button></td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Errore incidents:', err);
    }
}

// ── Tabella A/B Test ──────────────────────────────────────────────────────────
function updateABTable(data) {
    const tbody = document.getElementById('ab-tbody');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nessun dato A/B disponibile</td></tr>';
        return;
    }
    tbody.innerHTML = data.map((r, i) => `
        <tr>
            <td>${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : ''}<strong>${escapeHtml(r.variantId)}</strong></td>
            <td>${escapeHtml(String(r.totalSent ?? 0))}</td>
            <td>${escapeHtml(pct(r.accepted, r.totalSent))}</td>
            <td>${escapeHtml(pct(r.replied, r.totalSent))}</td>
            <td><span class="score-bar">
                <span class="score-bar-track"><span class="score-bar-fill" style="width:${Math.min(100, (r.ucbScore ?? 0) * 100).toFixed(1)}%"></span></span>
                <span class="score-bar-value">${escapeHtml((r.ucbScore ?? 0).toFixed(3))}</span>
            </span></td>
        </tr>
    `).join('');
}

// ── Tabella Runs ──────────────────────────────────────────────────────────────
function updateRunsTable(runs) {
    const tbody = document.getElementById('runs-tbody');
    if (!runs || runs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nessun run recente</td></tr>';
        return;
    }
    tbody.innerHTML = runs.map((r) => {
        const statusPill = r.status === 'COMPLETED'
            ? `<span class="pill pill-success">OK</span>`
            : r.status === 'RUNNING'
                ? `<span class="pill pill-info">In corso...</span>`
                : `<span class="pill pill-danger">${escapeHtml(r.status)}</span>`;

        const errorSnippet = r.error_message
            ? `<span class="pill pill-danger" title="${escapeHtml(r.error_message)}">⚠ ${escapeHtml(r.error_message.substring(0, 30))}...</span>`
            : '—';

        return `<tr>
            <td>${escapeHtml(String(r.id))}</td>
            <td>${formatDate(r.started_at)}</td>
            <td>${formatDate(r.finished_at)}</td>
            <td>${statusPill}</td>
            <td>${escapeHtml(String(r.profiles_discovered ?? 0))}</td>
            <td>${errorSnippet}</td>
        </tr>`;
    }).join('');
}

// ── Timing Slots ──────────────────────────────────────────────────────────────
function updateTimingList(slots) {
    const list = document.getElementById('timing-list');
    if (!slots || slots.length === 0) {
        list.innerHTML = '<div class="empty-state">Nessun dato timing disponibile</div>';
        return;
    }
    list.innerHTML = slots.map((s, i) => `
        <div class="timing-slot">
            <div class="timing-rank" aria-label="Posizione ${i + 1}">${i + 1}</div>
            <div class="timing-info">
                <div class="timing-label">Ora ${escapeHtml(String(s.hour ?? '?'))}:00</div>
                <div class="timing-meta">${escapeHtml(String(s.samples ?? 0))} campioni</div>
            </div>
            <div class="timing-score">${escapeHtml((s.score ?? 0).toFixed(2))}</div>
        </div>
    `).join('');
}

// ── Load principale (KPI + Funnel + Trend + Incidents + A/B + Timing + Runs) ──
async function loadData() {
    const [kpiRes, runsRes, abRes, slotsRes, trendRes] = await Promise.allSettled([
        fetch('/api/kpis'),
        fetch('/api/runs'),
        fetch('/api/ml/ab-leaderboard'),
        fetch('/api/ml/timing-slots'),
        fetch('/api/stats/trend'),
    ]);

    // ── KPI ──
    if (kpiRes.status === 'fulfilled' && kpiRes.value.ok) {
        const data = await kpiRes.value.json();
        const f = data.funnel;
        document.getElementById('val-invited').textContent = (f.invited ?? 0).toLocaleString();
        document.getElementById('val-accepted').textContent = (f.accepted ?? 0).toLocaleString();
        document.getElementById('val-messaged').textContent = (f.messaged ?? 0).toLocaleString();
        document.getElementById('val-replied').textContent = (f.replied ?? 0).toLocaleString();
        document.getElementById('val-total').textContent = (f.totalLeads ?? 0).toLocaleString();

        const riskScore = data.risk?.score ?? 0;
        const riskEl = document.getElementById('val-risk');
        riskEl.textContent = riskScore;
        riskEl.style.color = riskScore >= 80 ? 'var(--danger)' : riskScore >= 50 ? 'var(--warning)' : 'var(--success)';

        const sysState = document.getElementById('system-state');
        sysState.textContent = data.system.quarantined ? '🔴 Quarantena' : data.system.pausedUntil ? '⏸ Pausato' : '✅ OK';
        sysState.className = 'conv-value ' + (data.system.quarantined ? 'system-danger' : data.system.pausedUntil ? 'system-warn' : 'system-ok');

        document.getElementById('conv-accept').textContent = pct(f.accepted, f.invited);
        document.getElementById('conv-reply').textContent = pct(f.replied, f.invited);
        document.getElementById('conv-msg-reply').textContent = pct(f.replied, f.messaged);

        updateStatusBadge(data.system);
        updateFunnelChart(f);
    }

    // ── Trend 7gg ──
    if (trendRes.status === 'fulfilled' && trendRes.value.ok) {
        const trend = await trendRes.value.json();
        updateTrendChart(trend);
    }

    // ── Incidents ──
    await loadIncidents();

    // ── A/B ──
    if (abRes.status === 'fulfilled' && abRes.value.ok) {
        const ab = await abRes.value.json();
        updateABTable(ab);
    }

    // ── Timing Slots ──
    if (slotsRes.status === 'fulfilled' && slotsRes.value.ok) {
        const slots = await slotsRes.value.json();
        updateTimingList(slots);
    }

    // ── Runs ──
    if (runsRes.status === 'fulfilled' && runsRes.value.ok) {
        const runs = await runsRes.value.json();
        updateRunsTable(runs);
    }

    document.getElementById('last-refresh').textContent =
        'Ultimo aggiornamento: ' + new Date().toLocaleTimeString('it-IT', { hour12: false });
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadData();
startPolling();
connectEventStream();
