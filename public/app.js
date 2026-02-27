/**
 * app.js — LinkedIn Bot Dashboard Frontend
 * Polling ogni 30s su /api/kpis, /api/runs, /api/ml/ab-leaderboard, /api/ml/timing-slots
 * Usa Chart.js (CDN) per il funnel bar chart.
 */

'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30_000;
const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// ─── State ────────────────────────────────────────────────────────────────────
let funnelChart = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) { return n == null ? '—' : n.toLocaleString('it-IT'); }
function pct(num, den) { return den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '—'; }

async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    return res.json();
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function updateStatusBadge(kpiData) {
    const badge = document.getElementById('status-badge');
    const text = document.getElementById('status-text');
    const sys = kpiData.system;

    badge.className = 'status-badge';
    if (sys.quarantined) {
        badge.classList.add('status-quarantine');
        text.textContent = '🔒 Quarantena';
    } else if (sys.pausedUntil) {
        badge.classList.add('status-paused');
        const until = new Date(sys.pausedUntil);
        text.textContent = `⏸ In Pausa fino ${until.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
        badge.classList.add('status-running');
        text.textContent = '🟢 Operativo';
    }

    // System state in conversion panel
    const sysEl = document.getElementById('system-state');
    if (sysEl) {
        if (sys.quarantined) { sysEl.textContent = 'QUARANTENA'; sysEl.className = 'conv-value system-danger'; }
        else if (sys.pausedUntil) { sysEl.textContent = 'IN PAUSA'; sysEl.className = 'conv-value system-warn'; }
        else { sysEl.textContent = 'OK'; sysEl.className = 'conv-value system-ok'; }
    }
}

// ─── KPI Cards ────────────────────────────────────────────────────────────────
function updateKPIs(kpiData) {
    const f = kpiData.funnel;
    document.getElementById('val-invited').textContent = fmt(f.invited);
    document.getElementById('val-accepted').textContent = fmt(f.accepted);
    document.getElementById('val-messaged').textContent = fmt(f.messaged);
    document.getElementById('val-replied').textContent = fmt(f.replied);
    document.getElementById('val-total').textContent = fmt(f.totalLeads);

    const riskScore = kpiData.risk?.score ?? null;
    const riskEl = document.getElementById('val-risk');
    riskEl.textContent = riskScore != null ? riskScore : '—';
    riskEl.style.color = riskScore >= 70 ? 'var(--danger)' : riskScore >= 40 ? 'var(--warning)' : 'var(--success)';

    // Conversion rates
    document.getElementById('conv-accept').textContent = pct(f.accepted, f.invited);
    document.getElementById('conv-reply').textContent = pct(f.replied, f.invited);
    document.getElementById('conv-msg-reply').textContent = pct(f.replied, f.messaged);
}

// ─── Funnel Chart ─────────────────────────────────────────────────────────────
function updateFunnelChart(kpiData) {
    const f = kpiData.funnel;
    const labels = ['Inviti', 'Accettati', 'Pronti\nMessaggio', 'Messaggiati', 'Risposte'];
    const values = [f.invited, f.accepted, f.readyMessage, f.messaged, f.replied];
    const colors = ['#0077B5', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'];

    if (!funnelChart) {
        const ctx = document.getElementById('funnelChart').getContext('2d');
        funnelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors.map(c => c + '33'),
                    borderColor: colors,
                    borderWidth: 2,
                    borderRadius: 8,
                    borderSkipped: false,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.parsed.y.toLocaleString('it-IT')} lead`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: '#1f2d45' },
                        ticks: { color: '#8896b0', font: { size: 11 } }
                    },
                    y: {
                        grid: { color: '#1f2d45' },
                        ticks: { color: '#8896b0', font: { size: 11 } }
                    }
                }
            }
        });
    } else {
        funnelChart.data.datasets[0].data = values;
        funnelChart.update('active');
    }

    const el = document.getElementById('funnel-updated');
    if (el) el.textContent = new Date().toLocaleTimeString('it-IT');
}

// ─── A/B Leaderboard ──────────────────────────────────────────────────────────
function updateABTable(abData) {
    const tbody = document.getElementById('ab-tbody');
    if (!abData || abData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nessuna variante ancora testata</td></tr>';
        return;
    }

    tbody.innerHTML = abData.map((v, i) => {
        const accPct = (v.acceptanceRate * 100).toFixed(0);
        const replyPct = (v.replyRate * 100).toFixed(0);
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `
            <tr>
                <td>${medal} <code>${v.variantId}</code></td>
                <td>${fmt(v.sent)}</td>
                <td>
                    <div class="score-bar">
                        <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.min(accPct, 100)}%"></div></div>
                        <span class="score-bar-value">${accPct}%</span>
                    </div>
                </td>
                <td>${replyPct}%</td>
                <td style="color:var(--accent);font-weight:600">${v.ucbScore}</td>
            </tr>
        `;
    }).join('');
}

// ─── Timing Slots ─────────────────────────────────────────────────────────────
function updateTimingSlots(slots) {
    const container = document.getElementById('timing-list');
    if (!slots || slots.length === 0) {
        container.innerHTML = '<div class="empty-state">Dati insufficienti per il calcolo degli slot</div>';
        return;
    }

    container.innerHTML = slots.map((s, i) => `
        <div class="timing-slot">
            <div class="timing-rank">${i + 1}</div>
            <div class="timing-info">
                <div class="timing-label">${DOW_LABELS[s.dayOfWeek]} ${String(s.hour).padStart(2, '0')}:00</div>
                <div class="timing-meta">${s.sampleSize} campioni</div>
            </div>
            <div class="timing-score">${(s.score * 100).toFixed(0)}%</div>
        </div>
    `).join('');
}

// ─── Recent Runs ──────────────────────────────────────────────────────────────
function updateRunsTable(runs) {
    const tbody = document.getElementById('runs-tbody');
    if (!runs || runs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nessun run disponibile</td></tr>';
        return;
    }

    tbody.innerHTML = runs.map(r => {
        const statusPill = {
            'RUNNING': '<span class="pill pill-info">Running</span>',
            'COMPLETED': '<span class="pill pill-success">Completato</span>',
            'FAILED': '<span class="pill pill-danger">Fallito</span>',
        }[r.status] || `<span class="pill pill-neutral">${r.status}</span>`;

        const start = r.start_time ? new Date(r.start_time).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const end = r.end_time ? new Date(r.end_time).toLocaleString('it-IT', { timeStyle: 'short' }) : '—';
        const errSnippet = r.error_message ? `<span title="${r.error_message}" style="cursor:help;color:var(--danger)">⚠ ${r.error_message.substring(0, 40)}…</span>` : '—';

        return `
            <tr>
                <td style="color:var(--text-muted)">#${r.id}</td>
                <td>${start}</td>
                <td>${end}</td>
                <td>${statusPill}</td>
                <td style="font-weight:600">${r.profiles_discovered ?? 0}</td>
                <td style="font-size:0.78rem">${errSnippet}</td>
            </tr>
        `;
    }).join('');
}

// ─── Controls ─────────────────────────────────────────────────────────────────
async function controlPause() {
    try {
        const minutes = prompt('Metti in pausa per quanti minuti? (default: 60)', '60');
        if (minutes === null) return;
        await fetch('/api/controls/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutes: parseInt(minutes) || 60 })
        });
        setTimeout(loadData, 500);
    } catch (e) { console.error('Pause failed:', e); }
}

async function controlResume() {
    try {
        await fetch('/api/controls/resume', { method: 'POST' });
        setTimeout(loadData, 500);
    } catch (e) { console.error('Resume failed:', e); }
}

// ─── Main Load ────────────────────────────────────────────────────────────────
async function loadData() {
    try {
        const [kpiData, runs, abData, slotsData] = await Promise.allSettled([
            api('/api/kpis'),
            api('/api/runs'),
            api('/api/ml/ab-leaderboard'),
            api('/api/ml/timing-slots'),
        ]);

        if (kpiData.status === 'fulfilled') {
            updateStatusBadge(kpiData.value);
            updateKPIs(kpiData.value);
            updateFunnelChart(kpiData.value);
        }

        if (runs.status === 'fulfilled') updateRunsTable(runs.value);
        if (abData.status === 'fulfilled') updateABTable(abData.value);
        if (slotsData.status === 'fulfilled') updateTimingSlots(slotsData.value);

        const el = document.getElementById('last-refresh');
        if (el) el.textContent = `Ultimo aggiornamento: ${new Date().toLocaleTimeString('it-IT')}`;

    } catch (err) {
        console.error('[Dashboard] Errore caricamento dati:', err);
        const badge = document.getElementById('status-badge');
        if (badge) { badge.className = 'status-badge status-quarantine'; }
        const text = document.getElementById('status-text');
        if (text) text.textContent = 'API non raggiungibile';
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setInterval(loadData, POLL_INTERVAL_MS);
});
