/**
 * frontend/charts.ts
 * ─────────────────────────────────────────────────────────────────
 * Chart.js graphs for the dashboard:
 *   - Linea inviti/messaggi/giorno (7 giorni)
 *   - Gauge compliance health score
 */
let invitesChart = null;
let riskChart = null;
const BRAND_COLOR = '#0b6b78';
const ACCENT_COLOR = '#e8b931';
const DANGER_COLOR = '#b3261e';
const SUCCESS_COLOR = '#388e3c';
export function renderInvitesChart(trend) {
    if (typeof Chart === 'undefined')
        return;
    const canvas = document.getElementById('chart-invites-daily');
    if (!canvas)
        return;
    const labels = trend.map((r) => r.date.slice(5)); // MM-DD
    const invites = trend.map((r) => r.invitesSent);
    const messages = trend.map((r) => r.messagesSent);
    const acceptances = trend.map((r) => r.acceptances);
    if (invitesChart) {
        invitesChart.data.labels = labels;
        invitesChart.data.datasets[0].data = invites;
        invitesChart.data.datasets[1].data = messages;
        invitesChart.data.datasets[2].data = acceptances;
        invitesChart.update('none');
        return;
    }
    invitesChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Inviti',
                    data: invites,
                    borderColor: BRAND_COLOR,
                    backgroundColor: `${BRAND_COLOR}22`,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                },
                {
                    label: 'Messaggi',
                    data: messages,
                    borderColor: ACCENT_COLOR,
                    backgroundColor: `${ACCENT_COLOR}22`,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 3,
                },
                {
                    label: 'Accettati',
                    data: acceptances,
                    borderColor: SUCCESS_COLOR,
                    backgroundColor: `${SUCCESS_COLOR}22`,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, padding: 8, font: { size: 11 } },
                },
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { ticks: { font: { size: 10 } } },
            },
        },
    });
}
export function renderRiskGauge(riskScore, healthScore) {
    if (typeof Chart === 'undefined')
        return;
    const canvas = document.getElementById('chart-risk-gauge');
    if (!canvas)
        return;
    const clampedRisk = Math.max(0, Math.min(100, riskScore));
    const clampedHealth = Math.max(0, Math.min(100, healthScore));
    if (riskChart) {
        riskChart.data.datasets[0].data = [clampedRisk, 100 - clampedRisk];
        riskChart.data.datasets[1].data = [clampedHealth, 100 - clampedHealth];
        riskChart.update('none');
        return;
    }
    riskChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Risk Score', '', 'Health Score', ''],
            datasets: [
                {
                    label: 'Risk',
                    data: [clampedRisk, 100 - clampedRisk],
                    backgroundColor: [
                        clampedRisk > 70 ? DANGER_COLOR : clampedRisk > 40 ? ACCENT_COLOR : SUCCESS_COLOR,
                        '#e8e8e8',
                    ],
                    borderWidth: 0,
                },
                {
                    label: 'Health',
                    data: [clampedHealth, 100 - clampedHealth],
                    backgroundColor: [
                        clampedHealth > 70 ? SUCCESS_COLOR : clampedHealth > 40 ? ACCENT_COLOR : DANGER_COLOR,
                        '#f0f0f0',
                    ],
                    borderWidth: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 8,
                        font: { size: 11 },
                        generateLabels: () => [
                            { text: `Risk: ${clampedRisk}`, fillStyle: DANGER_COLOR, strokeStyle: 'transparent' },
                            { text: `Health: ${clampedHealth}`, fillStyle: SUCCESS_COLOR, strokeStyle: 'transparent' },
                        ],
                    },
                },
            },
        },
    });
}
export function destroyCharts() {
    invitesChart?.destroy();
    invitesChart = null;
    riskChart?.destroy();
    riskChart = null;
}
