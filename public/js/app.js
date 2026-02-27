// JS functionality for Dashboard

const API_URL = 'http://localhost:3000/api';

let isAppPaused = false;
let isQuarantine = false;

document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    setInterval(fetchData, 30000); // Polling every 30s
});

async function fetchData() {
    try {
        await Promise.all([
            fetchKPIs(),
            fetchRuns(),
            fetchABStats()
        ]);
    } catch (error) {
        showToast('Errore durante l\'aggiornamento dati', 'error');
        console.error(error);
    }
}

async function fetchKPIs() {
    const res = await fetch(`${API_URL}/kpis`);
    if (!res.ok) throw new Error('Failed to fetch KPIs');
    const data = await res.json();

    // Update metrics
    animateValue('kpi-connections', data.connections);
    animateValue('kpi-replies', data.replies);
    animateValue('kpi-qualified', data.qualifiedLeads);
    animateValue('kpi-meetings', data.meetingsBooked);

    // Update risk score
    const riskFill = document.getElementById('risk-progress');
    const riskScoreTxt = document.getElementById('risk-score');
    riskFill.style.width = `${data.riskScore}%`;
    riskScoreTxt.innerText = `${data.riskScore}/100`;

    riskFill.className = 'progress-fill safe';
    if (data.riskScore > 40) riskFill.className = 'progress-fill warning';
    if (data.riskScore > 75) riskFill.className = 'progress-fill danger';

    // Update Status
    updateGlobalStatus(data.isPaused, data.riskScore);

    // Update toggles
    isAppPaused = data.isPaused;
    const pauseBtn = document.getElementById('btn-pause');
    if (isAppPaused) {
        pauseBtn.innerText = 'Resume Bot';
        pauseBtn.className = 'btn btn-success';
        pauseBtn.style.color = 'var(--accent-green)';
        pauseBtn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    } else {
        pauseBtn.innerText = 'Pause Bot';
        pauseBtn.className = 'btn btn-warning';
        pauseBtn.style.color = 'var(--accent-yellow)';
        pauseBtn.style.borderColor = 'rgba(245, 158, 11, 0.2)';
    }

    isQuarantine = data.quarantine;
    document.getElementById('toggle-quarantine').checked = isQuarantine;
}

async function fetchRuns() {
    const res = await fetch(`${API_URL}/runs`);
    if (!res.ok) throw new Error('Failed to fetch runs');
    const runs = await res.json();

    const tbody = document.getElementById('runs-table-body');
    tbody.innerHTML = '';

    if (runs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Nessuna esecuzione recente.</td></tr>';
        return;
    }

    runs.forEach(run => {
        const start = new Date(run.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const end = run.end_time ? new Date(run.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${run.id}</td>
            <td>${run.workflow_type || 'Unknown'}</td>
            <td><span class="badge ${run.status}">${run.status}</span></td>
            <td>${start} - ${end}</td>
            <td>${run.leads_processed || 0}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function fetchABStats() {
    try {
        const res = await fetch(`${API_URL}/ab-testing/stats`);
        if (!res.ok) throw new Error('Failed to fetch A/B Stats');
        const stats = await res.json();

        const tbody = document.getElementById('ab-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (stats.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">No variants data available yet.</td></tr>';
            return;
        }

        stats.forEach(stat => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${stat.variant}</strong></td>
                <td>${stat.totalSent}</td>
                <td><span class="text-green">${stat.totalAccepted}</span></td>
                <td><span class="badge success">${stat.acceptanceRate.toFixed(1)}%</span></td>
                <td>${stat.totalReplied}</td>
                <td><span class="badge info">${stat.replyRate.toFixed(1)}%</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Fetch A/B Stats Error:', e);
    }
}

function updateGlobalStatus(paused, riskScore) {
    const dot = document.getElementById('global-status-dot');
    const text = document.getElementById('global-status-text');

    if (paused) {
        dot.className = 'dot paused';
        text.innerText = 'PAUSED';
        text.style.color = 'var(--accent-yellow)';
    } else if (riskScore > 75) {
        dot.className = 'dot danger';
        text.innerText = 'HIGH RISK';
        text.style.color = 'var(--accent-red)';
    } else {
        dot.className = 'dot active';
        text.innerText = 'RUNNING';
        text.style.color = 'var(--accent-green)';
    }
}

async function togglePause() {
    try {
        const endpoint = isAppPaused ? '/controls/resume' : '/controls/pause';
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(isAppPaused ? {} : { minutes: 1440 }) // Default 24h
        });

        const result = await res.json();
        if (result.success) {
            showToast(result.message, 'success');
            fetchData(); // reload state
        } else {
            showToast(result.error, 'error');
        }
    } catch (e) {
        showToast('Errore rete di connessione', 'error');
    }
}

async function toggleQuarantine(checkbox) {
    try {
        const enabled = checkbox.checked;
        const res = await fetch(`${API_URL}/controls/quarantine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });

        const result = await res.json();
        if (result.success) {
            showToast(result.message, 'success');
        } else {
            checkbox.checked = !enabled; // revert
            showToast(result.error, 'error');
        }
    } catch (e) {
        checkbox.checked = !checkbox.checked; // revert
        showToast('Errore rete di connessione', 'error');
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Helper animation for numbers
function animateValue(id, end) {
    const obj = document.getElementById(id);
    const start = parseInt(obj.innerText || '0', 10);
    if (start === end) return;

    let current = start;
    const increment = end > start ? Math.ceil((end - start) / 10) : Math.floor((end - start) / 10);
    const stepTime = Math.abs(Math.floor(200 / (end - start)));

    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        obj.innerText = current;
    }, stepTime || 10);
}
