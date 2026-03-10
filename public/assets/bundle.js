var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/frontend/apiClient.ts
function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
function ensureObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value;
}
var DASHBOARD_API_KEY_PARAM, DashboardApi;
var init_apiClient = __esm({
  "src/frontend/apiClient.ts"() {
    "use strict";
    DASHBOARD_API_KEY_PARAM = "api_key";
    DashboardApi = class _DashboardApi {
      bootstrapApiKey = "";
      cache = /* @__PURE__ */ new Map();
      static CACHE_TTL = {
        "/api/kpis": 15e3,
        "/api/runs": 3e4,
        "/api/incidents": 1e4,
        "/api/stats/trend": 6e4,
        "/api/risk/predictive": 6e4,
        "/api/review-queue": 2e4,
        "/api/ml/ab-leaderboard": 6e4,
        "/api/ml/timing-slots": 6e4,
        "/api/observability": 3e4,
        "/api/ai/comment-suggestions": 2e4
      };
      getCacheTtl(path) {
        const basePath = path.split("?")[0];
        return _DashboardApi.CACHE_TTL[basePath] ?? 15e3;
      }
      /** Invalida tutta la cache — il prossimo loadSnapshot farà fetch fresche. */
      forceRefresh() {
        this.cache.clear();
      }
      async apiFetch(path, init = {}, apiKeyOverride = "") {
        const headers = new Headers(init.headers ?? {});
        const apiKey = (apiKeyOverride || this.bootstrapApiKey || "").trim();
        if (apiKey && !headers.has("x-api-key")) {
          headers.set("x-api-key", apiKey);
        }
        return fetch(path, { ...init, headers });
      }
      async bootstrapSessionFromUrl() {
        let url;
        try {
          url = new URL(window.location.href);
        } catch {
          return;
        }
        const apiKey = (url.searchParams.get(DASHBOARD_API_KEY_PARAM) ?? "").trim();
        if (!apiKey) {
          return;
        }
        this.bootstrapApiKey = apiKey;
        try {
          const resp = await this.apiFetch("/api/auth/session", { method: "POST" }, apiKey);
          if (resp.ok) {
            url.searchParams.delete(DASHBOARD_API_KEY_PARAM);
            window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
          }
        } catch {
        } finally {
          this.bootstrapApiKey = "";
        }
      }
      async readJson(path, fallback) {
        const now = Date.now();
        const cached = this.cache.get(path);
        if (cached && now - cached.cachedAt < this.getCacheTtl(path)) {
          return cached.data;
        }
        const resp = await this.apiFetch(path);
        if (!resp.ok) {
          return fallback;
        }
        const raw = await resp.json();
        this.cache.set(path, { data: raw, cachedAt: now });
        return raw;
      }
      async pause(minutes) {
        const resp = await this.apiFetch("/api/controls/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes })
        });
        return resp.ok;
      }
      async resume() {
        const resp = await this.apiFetch("/api/controls/resume", { method: "POST" });
        return resp.ok;
      }
      async triggerRun(workflow = "all") {
        const resp = await this.apiFetch("/api/controls/trigger-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow })
        });
        return resp.ok;
      }
      async resolveIncident(id) {
        const resp = await this.apiFetch(`/api/incidents/${id}/resolve`, { method: "POST" });
        return resp.ok;
      }
      async approveCommentSuggestion(leadId, suggestionIndex, comment) {
        const payload = typeof comment === "string" && comment.trim().length > 0 ? { comment: comment.trim() } : {};
        const resp = await this.apiFetch(`/api/ai/comment-suggestions/${leadId}/${suggestionIndex}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        return resp.ok;
      }
      async rejectCommentSuggestion(leadId, suggestionIndex) {
        const resp = await this.apiFetch(`/api/ai/comment-suggestions/${leadId}/${suggestionIndex}/reject`, {
          method: "POST"
        });
        return resp.ok;
      }
      async searchLeads(query, status, list, page = 1) {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (status) params.set("status", status);
        if (list) params.set("list", list);
        params.set("page", String(page));
        params.set("pageSize", "25");
        return this.readJson(
          `/api/leads/search?${params.toString()}`,
          { leads: [], total: 0, page: 1, pageSize: 25 }
        );
      }
      async getLeadDetail(id) {
        const resp = await this.apiFetch(`/api/leads/${id}`);
        if (!resp.ok) return null;
        return await resp.json();
      }
      async loadSnapshot() {
        const [
          kpis,
          runs,
          incidents,
          trendRaw,
          predictive,
          reviewQueue,
          ab,
          timingSlots,
          observability,
          commentSuggestions
        ] = await Promise.all([
          this.readJson("/api/kpis", {
            funnel: { totalLeads: 0, invited: 0, accepted: 0, readyMessage: 0, messaged: 0, replied: 0 },
            system: { pausedUntil: null, quarantined: false }
          }),
          this.readJson("/api/runs", []),
          this.readJson("/api/incidents", []),
          this.readJson("/api/stats/trend", []),
          this.readJson("/api/risk/predictive", {
            enabled: false,
            lookbackDays: 0,
            alerts: []
          }),
          this.readJson("/api/review-queue?limit=25", {
            pending: false,
            lastIncidentId: null,
            reviewLeadCount: 0,
            challengeIncidentCount: 0,
            leads: [],
            incidents: []
          }),
          this.readJson("/api/ml/ab-leaderboard", []),
          this.readJson("/api/ml/timing-slots?n=8", []),
          this.readJson("/api/observability", {}),
          this.readJson("/api/ai/comment-suggestions?limit=20", {
            status: "REVIEW_PENDING",
            count: 0,
            rows: []
          })
        ]);
        const trend = Array.isArray(trendRaw) ? trendRaw : ensureArray(ensureObject(trendRaw).rows);
        const safeKpis = ensureObject(kpis);
        return {
          kpis: safeKpis,
          runs: ensureArray(runs),
          incidents: ensureArray(incidents),
          trend: ensureArray(trend),
          predictive: ensureObject(predictive),
          reviewQueue: ensureObject(reviewQueue),
          ab: ensureArray(ab),
          timingSlots: ensureArray(timingSlots),
          observability: ensureObject(observability),
          commentSuggestions: ensureObject(commentSuggestions)
        };
      }
    };
  }
});

// src/frontend/charts.ts
function renderInvitesChart(trend) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById("chart-invites-daily");
  if (!canvas) return;
  const labels = trend.map((r) => r.date.slice(5));
  const invites = trend.map((r) => r.invitesSent);
  const messages = trend.map((r) => r.messagesSent);
  const acceptances = trend.map((r) => r.acceptances);
  if (invitesChart) {
    invitesChart.data.labels = labels;
    invitesChart.data.datasets[0].data = invites;
    invitesChart.data.datasets[1].data = messages;
    invitesChart.data.datasets[2].data = acceptances;
    invitesChart.update("none");
    return;
  }
  invitesChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Inviti",
          data: invites,
          borderColor: BRAND_COLOR,
          backgroundColor: `${BRAND_COLOR}22`,
          fill: true,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: "Messaggi",
          data: messages,
          borderColor: ACCENT_COLOR,
          backgroundColor: `${ACCENT_COLOR}22`,
          fill: false,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: "Accettati",
          data: acceptances,
          borderColor: SUCCESS_COLOR,
          backgroundColor: `${SUCCESS_COLOR}22`,
          fill: false,
          tension: 0.3,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, padding: 8, font: { size: 11 } }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { font: { size: 10 } } }
      }
    }
  });
}
function renderRiskGauge(riskScore, healthScore) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById("chart-risk-gauge");
  if (!canvas) return;
  const clampedRisk = Math.max(0, Math.min(100, riskScore));
  const clampedHealth = Math.max(0, Math.min(100, healthScore));
  if (riskChart) {
    riskChart.data.datasets[0].data = [clampedRisk, 100 - clampedRisk];
    riskChart.data.datasets[1].data = [clampedHealth, 100 - clampedHealth];
    riskChart.update("none");
    return;
  }
  riskChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Risk Score", "", "Health Score", ""],
      datasets: [
        {
          label: "Risk",
          data: [clampedRisk, 100 - clampedRisk],
          backgroundColor: [
            clampedRisk > 70 ? DANGER_COLOR : clampedRisk > 40 ? ACCENT_COLOR : SUCCESS_COLOR,
            "#e8e8e8"
          ],
          borderWidth: 0
        },
        {
          label: "Health",
          data: [clampedHealth, 100 - clampedHealth],
          backgroundColor: [
            clampedHealth > 70 ? SUCCESS_COLOR : clampedHealth > 40 ? ACCENT_COLOR : DANGER_COLOR,
            "#f0f0f0"
          ],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            padding: 8,
            font: { size: 11 },
            generateLabels: () => [
              { text: `Risk: ${clampedRisk}`, fillStyle: DANGER_COLOR, strokeStyle: "transparent" },
              { text: `Health: ${clampedHealth}`, fillStyle: SUCCESS_COLOR, strokeStyle: "transparent" }
            ]
          }
        }
      }
    }
  });
}
var invitesChart, riskChart, BRAND_COLOR, ACCENT_COLOR, DANGER_COLOR, SUCCESS_COLOR;
var init_charts = __esm({
  "src/frontend/charts.ts"() {
    "use strict";
    invitesChart = null;
    riskChart = null;
    BRAND_COLOR = "#0b6b78";
    ACCENT_COLOR = "#e8b931";
    DANGER_COLOR = "#b3261e";
    SUCCESS_COLOR = "#388e3c";
  }
});

// src/frontend/dom.ts
function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Elemento non trovato: #${id}`);
  }
  return element;
}
function setText(id, text) {
  byId(id).textContent = text;
}
function formatDate(iso) {
  if (!iso) return "\u2014";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleString("it-IT", { hour12: false });
}
function formatPercent(num, den) {
  if (!den || den <= 0) return "0.0%";
  return `${(num / den * 100).toFixed(1)}%`;
}
function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}
function createCell(text, className) {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}
function asJsonObject(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }
  return input;
}
function readString(record, ...keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}
function exportToCSV(rows, filename) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => {
      const v = row[h];
      if (typeof v === "string" && (v.includes(",") || v.includes('"') || v.includes("\n"))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return String(v ?? "");
    });
    csvLines.push(values.join(","));
  }
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename);
}
function downloadCanvasAsPng(canvasId, filename) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const url = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
}
function printReport() {
  window.print();
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
var init_dom = __esm({
  "src/frontend/dom.ts"() {
    "use strict";
  }
});

// src/frontend/renderers.ts
function statusPill(text, className) {
  const pill = document.createElement("span");
  pill.className = `pill ${className}`;
  pill.textContent = text;
  return pill;
}
function updateSystemBadge(system) {
  const badge = byId("status-badge");
  const text = byId("status-text");
  badge.className = "status-badge";
  if (system.quarantined) {
    badge.classList.add("status-quarantine");
    text.textContent = "Quarantena attiva";
    return;
  }
  if (system.pausedUntil) {
    badge.classList.add("status-paused");
    text.textContent = `Pausato fino alle ${new Date(system.pausedUntil).toLocaleTimeString("it-IT", { hour12: false })}`;
    return;
  }
  badge.classList.add("status-running");
  text.textContent = "Operativo";
}
function renderKpis(kpis) {
  const funnel = kpis.funnel ?? {
    totalLeads: 0,
    invited: 0,
    accepted: 0,
    readyMessage: 0,
    messaged: 0,
    replied: 0
  };
  setText("val-invited", String(funnel.invited ?? 0));
  setText("val-accepted", String(funnel.accepted ?? 0));
  setText("val-messaged", String(funnel.messaged ?? 0));
  setText("val-replied", String(funnel.replied ?? 0));
  setText("val-total", String(funnel.totalLeads ?? 0));
  setText("val-ready-message", String(funnel.readyMessage ?? 0));
  const riskValue = Math.round(Number(kpis.risk?.score ?? 0));
  const riskNode = byId("val-risk");
  riskNode.textContent = String(riskValue);
  riskNode.className = riskValue >= 80 ? "kpi-value risk-high" : riskValue >= 50 ? "kpi-value risk-medium" : "kpi-value risk-low";
  setText("conv-accept", formatPercent(funnel.accepted ?? 0, funnel.invited ?? 0));
  setText("conv-reply", formatPercent(funnel.replied ?? 0, funnel.invited ?? 0));
  setText("conv-msg-reply", formatPercent(funnel.replied ?? 0, funnel.messaged ?? 0));
  const systemState = byId("system-state");
  if (kpis.system.quarantined) {
    systemState.textContent = "Quarantena";
    systemState.className = "conv-value system-danger";
  } else if (kpis.system.pausedUntil) {
    systemState.textContent = "Pausato";
    systemState.className = "conv-value system-warn";
  } else {
    systemState.textContent = "Stabile";
    systemState.className = "conv-value system-ok";
  }
  updateSystemBadge(kpis.system);
}
function renderKpiComparison(trend) {
  if (trend.length === 0) {
    setText("kpi-compare-invites", "\u2014");
    setText("kpi-compare-messages", "\u2014");
    setText("kpi-compare-accept", "\u2014");
    setText("kpi-compare-errors", "\u2014");
    return;
  }
  const latest = trend[trend.length - 1];
  const history = trend.slice(0, -1);
  const avg = (values) => {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const weekInvites = avg(history.map((item) => item.invitesSent));
  const weekMessages = avg(history.map((item) => item.messagesSent));
  const weekAccept = avg(history.map((item) => item.acceptances));
  const weekErrors = avg(history.map((item) => item.runErrors));
  setText("kpi-compare-invites", `${latest.invitesSent} oggi / ${weekInvites.toFixed(1)} media`);
  setText("kpi-compare-messages", `${latest.messagesSent} oggi / ${weekMessages.toFixed(1)} media`);
  setText("kpi-compare-accept", `${latest.acceptances} oggi / ${weekAccept.toFixed(1)} media`);
  setText("kpi-compare-errors", `${latest.runErrors} oggi / ${weekErrors.toFixed(1)} media`);
  const trendBody = byId("trend-tbody");
  clearChildren(trendBody);
  const fragment = document.createDocumentFragment();
  for (const row of trend.slice().reverse()) {
    const tr = document.createElement("tr");
    tr.appendChild(createCell(row.date));
    tr.appendChild(createCell(String(row.invitesSent)));
    tr.appendChild(createCell(String(row.messagesSent)));
    tr.appendChild(createCell(String(row.acceptances)));
    tr.appendChild(createCell(String(row.runErrors)));
    tr.appendChild(createCell(String(row.challenges)));
    tr.appendChild(createCell(String(Math.round(row.estimatedRiskScore ?? 0))));
    fragment.appendChild(tr);
  }
  trendBody.appendChild(fragment);
}
function renderPredictiveRisk(predictive) {
  const statusEl = byId("risk-predictive-status");
  const detailEl = byId("risk-predictive-detail");
  if (!predictive.enabled) {
    statusEl.textContent = "Disabilitato";
    statusEl.className = "conv-value";
    detailEl.textContent = "\u2014";
    return;
  }
  if (!predictive.alerts || predictive.alerts.length === 0) {
    statusEl.textContent = "Normale";
    statusEl.className = "conv-value system-ok";
    detailEl.textContent = `Baseline ${predictive.lookbackDays}g`;
    return;
  }
  const top = predictive.alerts[0];
  statusEl.textContent = "Anomalia";
  statusEl.className = "conv-value system-danger";
  detailEl.textContent = `${top.metric} z=${Number(top.zScore ?? 0).toFixed(2)}`;
}
function formatSloPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}
function renderOperationalSlo(slo) {
  if (!slo) {
    setText("slo-current-status", "SLO corrente: \u2014");
    setText("slo-7d-status", "SLO 7d: \u2014");
    setText("slo-30d-status", "SLO 30d: \u2014");
    return;
  }
  const current = slo.current ?? { status: "OK", queueLagSeconds: 0, oldestRunningJobSeconds: 0 };
  setText(
    "slo-current-status",
    `SLO corrente: ${slo.status} (queueLag ${Math.round(current.queueLagSeconds ?? 0)}s, running ${Math.round(current.oldestRunningJobSeconds ?? 0)}s)`
  );
  const window7d = (slo.windows ?? []).find((row) => row.windowDays === 7);
  const window30d = (slo.windows ?? []).find((row) => row.windowDays === 30);
  setText(
    "slo-7d-status",
    window7d ? `SLO 7d: ${window7d.status} (err ${formatSloPercent(window7d.errorRate)}, chall ${formatSloPercent(window7d.challengeRate)}, sel ${formatSloPercent(window7d.selectorFailureRate)})` : "SLO 7d: \u2014"
  );
  setText(
    "slo-30d-status",
    window30d ? `SLO 30d: ${window30d.status} (err ${formatSloPercent(window30d.errorRate)}, chall ${formatSloPercent(window30d.challengeRate)}, sel ${formatSloPercent(window30d.selectorFailureRate)})` : "SLO 30d: \u2014"
  );
}
function renderSelectorCacheKpi(kpi) {
  if (!kpi) {
    setText("selector-cache-kpi", "Selector cache KPI: \u2014");
    return;
  }
  const reduction = kpi.reductionPct === null ? "n/a" : `${kpi.reductionPct.toFixed(1)}%`;
  const target = `${(kpi.targetReductionRate * 100).toFixed(0)}%`;
  const status = kpi.validationStatus === "PASS" ? "PASS" : kpi.validationStatus === "WARN" ? "WARN" : "INSUFFICIENT_DATA";
  const baselineNote = kpi.validationStatus === "INSUFFICIENT_DATA" ? `, baseline<${kpi.minBaselineFailures}` : "";
  setText(
    "selector-cache-kpi",
    `Selector cache KPI 7d: ${status} (riduzione ${reduction}, target ${target}, fail ${kpi.currentFailures}/${kpi.previousFailures}${baselineNote})`
  );
}
function renderIncidents(incidents, selectedIds) {
  setText("incidents-count", incidents.length === 0 ? "Nessun incidente aperto" : `${incidents.length} aperti`);
  const tbody = byId("incidents-tbody");
  clearChildren(tbody);
  if (incidents.length === 0) {
    const row = document.createElement("tr");
    const cell = createCell("Nessun incidente aperto", "empty-state");
    cell.colSpan = 6;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const incident of incidents) {
    const row = document.createElement("tr");
    const selection = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "incident-select";
    checkbox.dataset.incidentId = String(incident.id);
    checkbox.checked = selectedIds.has(incident.id);
    selection.appendChild(checkbox);
    const typeCell = createCell(incident.type);
    const severityCell = document.createElement("td");
    const severityClass = incident.severity === "CRITICAL" ? "pill-danger" : incident.severity === "WARN" ? "pill-warning" : "pill-info";
    severityCell.appendChild(statusPill(incident.severity, severityClass));
    const detailsCell = document.createElement("td");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Dettagli";
    const pre = document.createElement("pre");
    pre.className = "incident-details";
    pre.textContent = incident.details_json && incident.details_json.trim().length > 0 ? incident.details_json : "Nessun dettaglio disponibile";
    details.appendChild(summary);
    details.appendChild(pre);
    detailsCell.appendChild(details);
    const actionCell = document.createElement("td");
    const resolveButton = document.createElement("button");
    resolveButton.type = "button";
    resolveButton.className = "btn btn-sm btn-success incident-resolve";
    resolveButton.dataset.incidentId = String(incident.id);
    resolveButton.textContent = "Risolvi";
    actionCell.appendChild(resolveButton);
    row.appendChild(selection);
    row.appendChild(createCell(String(incident.id)));
    row.appendChild(typeCell);
    row.appendChild(severityCell);
    row.appendChild(createCell(formatDate(incident.opened_at)));
    row.appendChild(detailsCell);
    row.appendChild(actionCell);
    fragment.appendChild(row);
  }
  tbody.appendChild(fragment);
}
function renderReviewQueue(reviewQueue) {
  setText("review-queue-count", String(reviewQueue.reviewLeadCount ?? 0));
  setText("review-queue-incidents", String(reviewQueue.challengeIncidentCount ?? 0));
  const queueCountNode = byId("review-queue-count");
  queueCountNode.className = (reviewQueue.reviewLeadCount ?? 0) > 0 ? "conv-value system-warn" : "conv-value system-ok";
  const incidentsNode = byId("review-queue-incidents");
  incidentsNode.className = (reviewQueue.challengeIncidentCount ?? 0) > 0 ? "conv-value system-danger" : "conv-value system-ok";
  const tbody = byId("review-tbody");
  clearChildren(tbody);
  if (!reviewQueue.leads || reviewQueue.leads.length === 0) {
    const row = document.createElement("tr");
    const cell = createCell("Nessun lead in review", "empty-state");
    cell.colSpan = 6;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const lead of reviewQueue.leads) {
    const row = document.createElement("tr");
    const priority = /challenge|captcha|block/i.test(lead.lastError ?? "") ? "Alta" : "Media";
    const nameCell = document.createElement("td");
    nameCell.textContent = `${lead.firstName} ${lead.lastName}`.trim();
    const actionCell = document.createElement("td");
    const profileButton = document.createElement("a");
    profileButton.className = "btn btn-sm btn-secondary";
    profileButton.href = lead.linkedinUrl;
    profileButton.target = "_blank";
    profileButton.rel = "noopener noreferrer";
    profileButton.textContent = "Apri profilo";
    actionCell.appendChild(profileButton);
    row.appendChild(createCell(String(lead.id)));
    row.appendChild(nameCell);
    row.appendChild(createCell(lead.listName || "default"));
    row.appendChild(createCell(priority));
    row.appendChild(createCell(lead.lastError ?? "Verifica stato su LinkedIn"));
    row.appendChild(actionCell);
    fragment.appendChild(row);
  }
  tbody.appendChild(fragment);
}
function renderCommentSuggestions(queue) {
  const rows = queue.rows ?? [];
  setText("comment-suggestions-count", rows.length > 0 ? `${rows.length} in review` : "Nessuna bozza in review");
  const tbody = byId("comment-suggestions-tbody");
  clearChildren(tbody);
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = createCell("Nessun suggerimento commento da revisionare", "empty-state");
    cell.colSpan = 6;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of rows) {
    const row = document.createElement("tr");
    const leadCell = document.createElement("td");
    const leadLink = document.createElement("a");
    leadLink.href = item.linkedinUrl;
    leadLink.target = "_blank";
    leadLink.rel = "noopener noreferrer";
    leadLink.textContent = `${item.firstName} ${item.lastName}`.trim() || `Lead #${item.leadId}`;
    leadCell.appendChild(leadLink);
    const postPreview = item.postSnippet?.trim().length > 0 ? item.postSnippet : "Post non disponibile";
    const commentCell = document.createElement("td");
    const editor = document.createElement("textarea");
    editor.className = "comment-suggestion-editor";
    editor.value = item.comment ?? "";
    editor.dataset.leadId = String(item.leadId);
    editor.dataset.suggestionIndex = String(item.suggestionIndex);
    editor.maxLength = 280;
    commentCell.appendChild(editor);
    const actionsCell = document.createElement("td");
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "comment-suggestion-actions";
    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.className = "btn btn-sm btn-success comment-suggestion-approve";
    approveButton.dataset.leadId = String(item.leadId);
    approveButton.dataset.suggestionIndex = String(item.suggestionIndex);
    approveButton.textContent = "Approva";
    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.className = "btn btn-sm btn-danger comment-suggestion-reject";
    rejectButton.dataset.leadId = String(item.leadId);
    rejectButton.dataset.suggestionIndex = String(item.suggestionIndex);
    rejectButton.textContent = "Rifiuta";
    actionsWrap.appendChild(approveButton);
    actionsWrap.appendChild(rejectButton);
    actionsCell.appendChild(actionsWrap);
    row.appendChild(leadCell);
    row.appendChild(createCell(item.listName || "default"));
    row.appendChild(createCell(postPreview));
    row.appendChild(commentCell);
    row.appendChild(createCell(`${Math.round((item.confidence ?? 0) * 100)}%`));
    row.appendChild(actionsCell);
    fragment.appendChild(row);
  }
  tbody.appendChild(fragment);
}
function renderRuns(runs) {
  const tbody = byId("runs-tbody");
  clearChildren(tbody);
  if (runs.length === 0) {
    const row = document.createElement("tr");
    const cell = createCell("Nessun run recente", "empty-state");
    cell.colSpan = 7;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    const row = document.createElement("tr");
    row.appendChild(createCell(String(run.id)));
    row.appendChild(createCell(formatDate(run.start_time)));
    row.appendChild(createCell(formatDate(run.end_time)));
    row.appendChild(createCell(run.status));
    row.appendChild(createCell(String(run.profiles_discovered ?? 0)));
    row.appendChild(createCell(String(run.invites_sent ?? 0)));
    row.appendChild(createCell(String(run.messages_sent ?? 0)));
    fragment.appendChild(row);
  }
  tbody.appendChild(fragment);
}
function renderAbLeaderboard(rows) {
  const tbody = byId("ab-tbody");
  clearChildren(tbody);
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = createCell("Nessun dato A/B disponibile", "empty-state");
    cell.colSpan = 6;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  rows.forEach((item, index) => {
    const row = document.createElement("tr");
    const variantPrefix = index === 0 ? "1\xB0 " : index === 1 ? "2\xB0 " : index === 2 ? "3\xB0 " : "";
    const sent = item.totalSent ?? item.sent ?? 0;
    const score = item.bayesScore ?? item.ucbScore ?? 0;
    const winnerSuffix = item.significanceWinner ? " [WIN]" : "";
    row.appendChild(createCell(`${variantPrefix}${item.variantId}${winnerSuffix}`));
    row.appendChild(createCell(String(sent)));
    row.appendChild(createCell(formatPercent(item.accepted ?? 0, sent)));
    row.appendChild(createCell(formatPercent(item.replied ?? 0, sent)));
    row.appendChild(createCell(score.toFixed(3)));
    fragment.appendChild(row);
  });
  tbody.appendChild(fragment);
}
function renderTimingSlots(slots) {
  const list = byId("timing-list");
  clearChildren(list);
  if (slots.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nessun dato timing disponibile";
    list.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  slots.forEach((slot, index) => {
    const item = document.createElement("div");
    item.className = "timing-slot";
    const rank = document.createElement("span");
    rank.className = "timing-rank";
    rank.textContent = String(index + 1);
    const label = document.createElement("span");
    label.className = "timing-label";
    label.textContent = `${slot.hour}:00 - score ${slot.score.toFixed(2)} (${slot.samples} campioni)`;
    item.appendChild(rank);
    item.appendChild(label);
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
}
function renderTimeline(entries, optionSets) {
  const timelineList = byId("timeline-list");
  clearChildren(timelineList);
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nessun evento realtime disponibile";
    timelineList.appendChild(empty);
  } else {
    const fragment = document.createDocumentFragment();
    for (const entry of entries.slice(0, 150)) {
      const article = document.createElement("article");
      article.className = "timeline-item";
      const header = document.createElement("div");
      header.className = "timeline-head";
      header.textContent = `${formatDate(entry.timestamp)} \xB7 ${entry.type}`;
      const summary = document.createElement("div");
      summary.className = "timeline-summary";
      summary.textContent = entry.summary;
      const meta = document.createElement("div");
      meta.className = "timeline-meta";
      meta.textContent = `account=${entry.accountId ?? "n/a"} \xB7 list=${entry.listName ?? "n/a"}`;
      article.appendChild(header);
      article.appendChild(summary);
      article.appendChild(meta);
      fragment.appendChild(article);
    }
    timelineList.appendChild(fragment);
  }
  populateSelect("timeline-filter-type", optionSets.types);
  populateSelect("timeline-filter-account", optionSets.accountIds);
  populateSelect("timeline-filter-list", optionSets.listNames);
}
function populateSelect(id, values) {
  const select = byId(id);
  const previousValue = select.value;
  clearChildren(select);
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All";
  select.appendChild(allOption);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (previousValue && (previousValue === "all" || values.includes(previousValue))) {
    select.value = previousValue;
  } else {
    select.value = "all";
  }
}
function renderLeadSearchResults(leads, total, page, pageSize, onPageChange, onLeadClick) {
  const tbody = byId("lead-search-tbody");
  const info = byId("lead-search-info");
  const pager = byId("lead-search-pager");
  clearChildren(tbody);
  clearChildren(pager);
  if (leads.length === 0) {
    info.textContent = total === 0 ? "Nessun risultato" : "Caricamento...";
    return;
  }
  const totalPages = Math.ceil(total / pageSize);
  info.textContent = `${total} lead trovati \u2014 Pagina ${page}/${totalPages}`;
  for (const lead of leads) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => onLeadClick(lead.id));
    const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "\u2014";
    tr.appendChild(createCell(fullName));
    tr.appendChild(createCell(lead.account_name ?? "\u2014"));
    tr.appendChild(createCell(lead.job_title ?? "\u2014"));
    const statusTd = document.createElement("td");
    statusTd.appendChild(statusPill(lead.status, `pill-${lead.status.toLowerCase()}`));
    tr.appendChild(statusTd);
    tr.appendChild(createCell(lead.list_name ?? "\u2014"));
    tr.appendChild(createCell(lead.lead_score != null ? String(lead.lead_score) : "\u2014"));
    tr.appendChild(createCell(lead.updated_at ? formatDate(lead.updated_at) : "\u2014"));
    tbody.appendChild(tr);
  }
  if (totalPages > 1) {
    if (page > 1) {
      const prev = document.createElement("button");
      prev.textContent = "\u2190 Precedente";
      prev.className = "btn btn-small";
      prev.addEventListener("click", () => onPageChange(page - 1));
      pager.appendChild(prev);
    }
    const span = document.createElement("span");
    span.textContent = ` ${page} / ${totalPages} `;
    span.style.margin = "0 0.5rem";
    pager.appendChild(span);
    if (page < totalPages) {
      const next = document.createElement("button");
      next.textContent = "Successiva \u2192";
      next.className = "btn btn-small";
      next.addEventListener("click", () => onPageChange(page + 1));
      pager.appendChild(next);
    }
  }
}
function renderLeadDetail(lead, timeline) {
  const container = byId("lead-detail-content");
  clearChildren(container);
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown";
  const header = document.createElement("h3");
  header.textContent = fullName;
  container.appendChild(header);
  const meta = document.createElement("div");
  meta.className = "lead-detail-meta";
  meta.innerHTML = `
        <p><strong>Azienda:</strong> ${lead.account_name ?? "\u2014"}</p>
        <p><strong>Titolo:</strong> ${lead.job_title ?? "\u2014"}</p>
        <p><strong>Stato:</strong> ${lead.status}</p>
        <p><strong>Lista:</strong> ${lead.list_name ?? "\u2014"}</p>
        <p><strong>Score:</strong> ${lead.lead_score ?? "\u2014"}</p>
        <p><strong>Email:</strong> ${lead.email ?? "\u2014"}</p>
        <p><strong>LinkedIn:</strong> <a href="${lead.linkedin_url}" target="_blank" rel="noopener">${lead.linkedin_url}</a></p>
    `;
  container.appendChild(meta);
  if (timeline.length > 0) {
    const timelineHeader = document.createElement("h4");
    timelineHeader.textContent = "Timeline";
    timelineHeader.style.marginTop = "1rem";
    container.appendChild(timelineHeader);
    const table = document.createElement("table");
    table.className = "compact-table";
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Da</th><th>A</th><th>Motivo</th><th>Data</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const evt of timeline) {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(evt.from_status));
      tr.appendChild(createCell(evt.to_status));
      tr.appendChild(createCell(evt.reason));
      tr.appendChild(createCell(formatDate(evt.created_at)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }
}
var init_renderers = __esm({
  "src/frontend/renderers.ts"() {
    "use strict";
    init_dom();
  }
});

// src/frontend/timeline.ts
function summarize(type, payload) {
  if (type === "run.log") {
    const eventName = readString(payload, "event") ?? "run.log";
    const level = readString(payload, "level") ?? "INFO";
    return `[${level}] ${eventName}`;
  }
  if (type.startsWith("incident.")) {
    const incidentId = readString(payload, "incidentId", "incident_id");
    return incidentId ? `${type} #${incidentId}` : type;
  }
  if (type.startsWith("lead.")) {
    const leadId = readString(payload, "leadId", "lead_id");
    const status = readString(payload, "toStatus", "to_status", "status");
    if (leadId && status) {
      return `Lead ${leadId} -> ${status}`;
    }
    if (leadId) {
      return `Lead ${leadId}`;
    }
  }
  return type;
}
function extractAccount(payload) {
  return readString(payload, "accountId", "account_id");
}
function extractList(payload) {
  return readString(payload, "listName", "list_name");
}
var MAX_TIMELINE_ENTRIES, TimelineStore;
var init_timeline = __esm({
  "src/frontend/timeline.ts"() {
    "use strict";
    init_dom();
    MAX_TIMELINE_ENTRIES = 300;
    TimelineStore = class {
      entries = [];
      push(type, rawPayload, timestamp = (/* @__PURE__ */ new Date()).toISOString()) {
        const payload = asJsonObject(rawPayload);
        const entry = {
          id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          timestamp,
          accountId: extractAccount(payload),
          listName: extractList(payload),
          summary: summarize(type, payload),
          payload
        };
        this.entries.unshift(entry);
        if (this.entries.length > MAX_TIMELINE_ENTRIES) {
          this.entries.length = MAX_TIMELINE_ENTRIES;
        }
      }
      replace(entries) {
        this.entries = entries.slice(0, MAX_TIMELINE_ENTRIES);
      }
      getEntries(filter) {
        return this.entries.filter((entry) => {
          if (filter.type !== "all" && entry.type !== filter.type) {
            return false;
          }
          if (filter.accountId !== "all" && entry.accountId !== filter.accountId) {
            return false;
          }
          if (filter.listName !== "all" && entry.listName !== filter.listName) {
            return false;
          }
          return true;
        });
      }
      getFilterValues() {
        const types = /* @__PURE__ */ new Set();
        const accountIds = /* @__PURE__ */ new Set();
        const listNames = /* @__PURE__ */ new Set();
        for (const entry of this.entries) {
          types.add(entry.type);
          if (entry.accountId) accountIds.add(entry.accountId);
          if (entry.listName) listNames.add(entry.listName);
        }
        return {
          types: Array.from(types).sort(),
          accountIds: Array.from(accountIds).sort(),
          listNames: Array.from(listNames).sort()
        };
      }
    };
  }
});

// src/frontend/voiceCommands.ts
function normalizeTranscript(raw) {
  return raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function parsePauseMinutes(normalized) {
  const match = normalized.match(/(?:pausa|ferma|stop)\s+(\d{1,4})\s*(?:min|minute|minuti)?/i);
  if (!match) return 60;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(parsed)) return 60;
  return Math.max(1, Math.min(10080, parsed));
}
function parseVoiceCommand(transcript) {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;
  if (normalized.includes("aggiorna") || normalized.includes("refresh") || normalized.includes("ricarica")) {
    return { kind: "refresh" };
  }
  if (normalized.includes("pausa") || normalized.includes("ferma") || normalized.includes("stop automazione")) {
    return { kind: "pause", minutes: parsePauseMinutes(normalized) };
  }
  if (normalized.includes("riprendi") || normalized.includes("resume") || normalized.includes("riattiva") || normalized.includes("riparti")) {
    return { kind: "resume" };
  }
  if (normalized.includes("risolvi selezionati") || normalized.includes("risolvi incidenti selezionati") || normalized.includes("chiudi selezionati")) {
    return { kind: "resolve_selected" };
  }
  if (normalized.includes("avvia run") || normalized.includes("start run") || normalized.includes("lancia workflow") || normalized.includes("esegui workflow")) {
    const workflow = parseWorkflowFromTranscript(normalized);
    return { kind: "trigger_run", workflow };
  }
  if (normalized.includes("esporta") || normalized.includes("export") || normalized.includes("scarica csv")) {
    return { kind: "export_csv" };
  }
  if (normalized.includes("tema") || normalized.includes("dark mode") || normalized.includes("modalita scura") || normalized.includes("cambia tema")) {
    return { kind: "toggle_theme" };
  }
  if (normalized.includes("stampa") || normalized.includes("print")) {
    return { kind: "print_report" };
  }
  return null;
}
function parseWorkflowFromTranscript(normalized) {
  if (normalized.includes("invit")) return "invite";
  if (normalized.includes("messag")) return "message";
  if (normalized.includes("check") || normalized.includes("verifica")) return "check";
  if (normalized.includes("warmup") || normalized.includes("riscaldamento")) return "warmup";
  return "all";
}
function isCriticalVoiceAction(action) {
  return action.kind === "pause" || action.kind === "resume" || action.kind === "resolve_selected" || action.kind === "trigger_run";
}
function describeVoiceAction(action) {
  switch (action.kind) {
    case "refresh":
      return "Aggiorna dashboard";
    case "pause":
      return `Pausa automazione (${action.minutes} min)`;
    case "resume":
      return "Riprendi automazione";
    case "resolve_selected":
      return "Risolvi incidenti selezionati";
    case "trigger_run":
      return `Avvia run workflow "${action.workflow}"`;
    case "export_csv":
      return "Esporta trend CSV";
    case "toggle_theme":
      return "Cambia tema";
    case "print_report":
      return "Stampa report";
  }
}
var init_voiceCommands = __esm({
  "src/frontend/voiceCommands.ts"() {
    "use strict";
  }
});

// src/frontend/main.ts
var require_main = __commonJS({
  "src/frontend/main.ts"() {
    init_apiClient();
    init_charts();
    init_dom();
    init_renderers();
    init_timeline();
    init_voiceCommands();
    var POLL_INTERVAL_MS = 2e4;
    var SSE_RECONNECT_BASE_MS = 2e3;
    var SPEECH_RECOGNITION_LANG = "it-IT";
    var api = new DashboardApi();
    var timeline = new TimelineStore();
    var selectedIncidentIds = /* @__PURE__ */ new Set();
    var lastTrendData = [];
    var eventSource = null;
    var wsConnection = null;
    var pollTimer = null;
    var refreshTimer = null;
    var reconnectTimer = null;
    var reconnectAttempts = 0;
    var PREFS_KEY = "lkbot_ui_prefs";
    function loadUiPrefs() {
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            filter: {
              type: parsed.filter?.type ?? "all",
              accountId: parsed.filter?.accountId ?? "all",
              listName: parsed.filter?.listName ?? "all"
            },
            theme: parsed.theme ?? "auto"
          };
        }
      } catch {
      }
      return { filter: { type: "all", accountId: "all", listName: "all" }, theme: "auto" };
    }
    function applyTheme(theme) {
      if (theme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else if (theme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    }
    function cycleTheme(current) {
      if (current === "auto") return "dark";
      if (current === "dark") return "light";
      return "auto";
    }
    function saveUiPrefs(prefs) {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
      }
    }
    var initialPrefs = loadUiPrefs();
    var currentFilter = initialPrefs.filter;
    var currentTheme = initialPrefs.theme;
    applyTheme(currentTheme);
    function updateSseIndicator(state) {
      const el = document.getElementById("sse-indicator");
      const textEl = document.getElementById("sse-text");
      const reconnectBtn = document.getElementById("sse-reconnect");
      if (!el || !textEl) return;
      el.classList.remove("sse-unknown", "sse-connected", "sse-disconnected");
      switch (state) {
        case "UNKNOWN":
          el.classList.add("sse-unknown");
          textEl.textContent = "Connessione...";
          if (reconnectBtn) reconnectBtn.hidden = true;
          break;
        case "CONNECTED":
          el.classList.add("sse-connected");
          textEl.textContent = "Live";
          if (reconnectBtn) reconnectBtn.hidden = true;
          break;
        case "DISCONNECTED":
          el.classList.add("sse-disconnected");
          textEl.textContent = "Disconnesso";
          if (reconnectBtn) reconnectBtn.hidden = false;
          break;
      }
      updateFavicon(state);
    }
    function updateFavicon(state) {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0A66C2";
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("LB", 16, 17);
      if (state !== "UNKNOWN") {
        ctx.fillStyle = state === "CONNECTED" ? "#22c55e" : "#ef4444";
        ctx.beginPath();
        ctx.arc(26, 26, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = canvas.toDataURL("image/png");
    }
    var voiceRecognition = null;
    var isVoiceListening = false;
    var pendingVoiceAction = null;
    var notificationsGranted = false;
    function requestNotificationPermission() {
      if (!("Notification" in window)) return;
      if (Notification.permission === "granted") {
        notificationsGranted = true;
        return;
      }
      if (Notification.permission !== "denied") {
        void Notification.requestPermission().then((perm) => {
          notificationsGranted = perm === "granted";
        });
      }
    }
    function fireDesktopNotification(eventType, rawData) {
      if (!notificationsGranted) return;
      if (document.hasFocus()) return;
      let title = "LinkedIn Bot";
      let body = eventType;
      try {
        const parsed = JSON.parse(rawData);
        if (eventType === "incident.opened") {
          const severity = String(parsed.severity ?? "INFO");
          const type = String(parsed.type ?? "incident");
          title = `Incidente ${severity}`;
          body = type;
        } else if (eventType === "system.quarantine") {
          title = "Quarantena attivata";
          body = String(parsed.reason ?? "Il sistema \xE8 entrato in quarantena");
        } else if (eventType === "challenge.review_queued") {
          title = "Challenge rilevato";
          body = "Un lead richiede review manuale";
        }
      } catch {
      }
      try {
        new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: `lkbot-${eventType}`
        });
      } catch {
      }
    }
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
        type: byId("timeline-filter-type").value || "all",
        accountId: byId("timeline-filter-account").value || "all",
        listName: byId("timeline-filter-list").value || "all"
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
        const payload = parsed.payload ?? parsed;
        const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : (/* @__PURE__ */ new Date()).toISOString();
        timeline.push(type, payload, timestamp);
      } catch {
        timeline.push(type, { raw: data }, (/* @__PURE__ */ new Date()).toISOString());
      }
      renderTimelineSection();
    }
    var TRACKED_EVENTS = [
      "connected",
      "lead.transition",
      "lead.reconciled",
      "incident.opened",
      "incident.resolved",
      "automation.paused",
      "automation.resumed",
      "system.quarantine",
      "challenge.review_queued",
      "run.log"
    ];
    var NOTIFICATION_EVENTS = /* @__PURE__ */ new Set(["incident.opened", "system.quarantine", "challenge.review_queued"]);
    function handleRealtimeEvent(eventName, data) {
      appendTimelineEvent(eventName, data);
      scheduleRefresh(eventName === "run.log" ? 350 : 200);
      if (NOTIFICATION_EVENTS.has(eventName)) {
        fireDesktopNotification(eventName, data);
      }
    }
    function scheduleReconnect() {
      reconnectAttempts += 1;
      updateSseIndicator("DISCONNECTED");
      const delay = Math.min(3e4, SSE_RECONNECT_BASE_MS * Math.pow(2, Math.min(6, reconnectAttempts)));
      reconnectTimer = window.setTimeout(() => {
        if (!document.hidden) {
          connectEventStream();
        }
      }, delay);
    }
    function connectWebSocket() {
      if (typeof WebSocket === "undefined") return false;
      try {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${location.host}/ws`);
        ws.onopen = () => {
          wsConnection = ws;
          reconnectAttempts = 0;
          updateSseIndicator("CONNECTED");
        };
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type && msg.type !== "heartbeat" && TRACKED_EVENTS.includes(msg.type)) {
              handleRealtimeEvent(msg.type, evt.data);
            }
          } catch {
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
    function connectSseFallback() {
      eventSource = new EventSource("/api/events");
      TRACKED_EVENTS.forEach((eventName) => {
        eventSource?.addEventListener(eventName, (evt) => {
          handleRealtimeEvent(eventName, evt.data);
        });
      });
      eventSource.onopen = () => {
        reconnectAttempts = 0;
        updateSseIndicator("CONNECTED");
      };
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        scheduleReconnect();
      };
    }
    function connectEventStream() {
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
      if (!connectWebSocket()) {
        connectSseFallback();
      }
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
      updateSseIndicator("UNKNOWN");
    }
    async function refreshDashboard() {
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
        setText("ops-priority-summary", `Review lead: ${queueCount} \xB7 Challenge incidenti: ${incidentCount}`);
        setText("last-refresh", `Ultimo aggiornamento: ${(/* @__PURE__ */ new Date()).toLocaleTimeString("it-IT", { hour12: false })}`);
      } catch (error) {
        setText("last-refresh", "Ultimo aggiornamento: errore refresh");
        console.error("Errore refresh dashboard", error);
      }
    }
    function setStatusMessage(message) {
      setText("action-feedback", message);
    }
    function setVoiceMessage(message) {
      setText("voice-feedback", message);
    }
    function setVoiceFeedbackVisible(visible) {
      const wrap = document.getElementById("voice-feedback-wrap");
      const mic = document.getElementById("voice-mic-indicator");
      if (wrap) wrap.hidden = !visible;
      if (mic) mic.classList.toggle("listening", visible);
    }
    function setVoiceButtonState(listening) {
      const voiceButton = byId("btn-voice");
      voiceButton.classList.remove("btn-secondary", "btn-danger");
      if (listening) {
        voiceButton.classList.add("btn-danger");
        voiceButton.textContent = "Stop Voce";
        voiceButton.setAttribute("aria-pressed", "true");
        return;
      }
      voiceButton.classList.add("btn-secondary");
      voiceButton.textContent = "Comando Voce";
      voiceButton.setAttribute("aria-pressed", "false");
    }
    function readTranscriptFromSpeechEvent(event) {
      const chunks = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result || !result[0]) continue;
        if (result.isFinal) {
          chunks.push(result[0].transcript);
        }
      }
      return chunks.join(" ").trim();
    }
    function showVoiceConfirmDialog(transcript, action) {
      setText("voice-transcript-text", transcript);
      setText("voice-action-summary", describeVoiceAction(action));
      byId("voice-command-modal").showModal();
    }
    function clearVoiceConfirmDialog() {
      pendingVoiceAction = null;
      byId("voice-command-modal").close();
    }
    async function resolveSelectedIncidents() {
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
    async function executeVoiceAction(action) {
      if (action.kind === "refresh") {
        await refreshDashboard();
        setStatusMessage("Dashboard aggiornata (voce)");
        setVoiceMessage("Comando vocale eseguito: aggiorna");
        return;
      }
      if (action.kind === "pause") {
        const ok = await api.pause(action.minutes);
        setStatusMessage(ok ? `Pausa attivata per ${action.minutes} minuti` : "Errore durante la pausa");
        setVoiceMessage(ok ? "Comando vocale eseguito: pausa" : "Comando vocale fallito: pausa");
        if (ok) {
          await refreshDashboard();
        }
        return;
      }
      if (action.kind === "resume") {
        const ok = await api.resume();
        setStatusMessage(ok ? "Automazione ripresa" : "Errore durante la ripresa");
        setVoiceMessage(ok ? "Comando vocale eseguito: riprendi" : "Comando vocale fallito: riprendi");
        if (ok) {
          await refreshDashboard();
        }
        return;
      }
      if (action.kind === "trigger_run") {
        const ok = await api.triggerRun(action.workflow);
        setStatusMessage(ok ? `Run "${action.workflow}" schedulato` : "Errore trigger run");
        setVoiceMessage(ok ? `Comando vocale eseguito: avvia run ${action.workflow}` : "Comando vocale fallito: trigger run");
        return;
      }
      if (action.kind === "export_csv") {
        document.getElementById("btn-export-csv")?.click();
        setVoiceMessage("Comando vocale eseguito: esporta CSV");
        return;
      }
      if (action.kind === "toggle_theme") {
        document.getElementById("btn-theme-toggle")?.click();
        setVoiceMessage("Comando vocale eseguito: cambia tema");
        return;
      }
      if (action.kind === "print_report") {
        printReport();
        setVoiceMessage("Comando vocale eseguito: stampa report");
        return;
      }
      const report = await resolveSelectedIncidents();
      if (report.total === 0) {
        setStatusMessage("Nessun incidente selezionato");
        setVoiceMessage("Comando vocale annullato: nessun incidente selezionato");
        return;
      }
      setStatusMessage(`Incidenti risolti: ${report.resolved}/${report.total}`);
      setVoiceMessage(`Comando vocale eseguito: risolti ${report.resolved}/${report.total}`);
      await refreshDashboard();
    }
    async function handleVoiceTranscript(transcript) {
      if (!transcript.trim()) {
        setVoiceMessage("Nessun testo riconosciuto");
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
    function bindVoiceControls() {
      const voiceButton = byId("btn-voice");
      const modal = byId("voice-command-modal");
      const cancelBtn = byId("voice-cancel-btn");
      const confirmBtn = byId("voice-confirm-btn");
      cancelBtn.addEventListener("click", () => {
        clearVoiceConfirmDialog();
        setVoiceMessage("Conferma comando vocale annullata");
      });
      modal.addEventListener("close", () => {
        pendingVoiceAction = null;
      });
      confirmBtn.addEventListener("click", () => {
        const action = pendingVoiceAction;
        clearVoiceConfirmDialog();
        if (!action) {
          setVoiceMessage("Nessun comando vocale da confermare");
          return;
        }
        void executeVoiceAction(action);
      });
      const speechWindow = window;
      const RecognitionCtor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
      if (!RecognitionCtor) {
        voiceButton.disabled = true;
        voiceButton.title = "Web Speech API non disponibile in questo browser";
        setVoiceMessage("Comandi vocali non disponibili su questo browser");
        return;
      }
      const recognition = new RecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = SPEECH_RECOGNITION_LANG;
      recognition.onstart = () => {
        isVoiceListening = true;
        setVoiceButtonState(true);
        setVoiceMessage("Ascolto in corso...");
        setVoiceFeedbackVisible(true);
      };
      recognition.onend = () => {
        isVoiceListening = false;
        setVoiceButtonState(false);
        setVoiceFeedbackVisible(false);
        setText("voice-partial-transcript", "");
      };
      recognition.onerror = (event) => {
        const errorCode = event.error ?? "unknown";
        setVoiceMessage(`Errore riconoscimento vocale: ${errorCode}`);
        setVoiceFeedbackVisible(false);
      };
      recognition.onresult = (event) => {
        const partials = [];
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result || !result[0]) continue;
          if (!result.isFinal) {
            partials.push(result[0].transcript);
          }
        }
        if (partials.length > 0) {
          setText("voice-partial-transcript", partials.join(" "));
        }
        const transcript = readTranscriptFromSpeechEvent(event);
        if (transcript) {
          setText("voice-partial-transcript", "");
          void handleVoiceTranscript(transcript);
        }
      };
      voiceRecognition = recognition;
      setVoiceButtonState(false);
      voiceButton.addEventListener("click", () => {
        if (!voiceRecognition) {
          setVoiceMessage("Riconoscimento vocale non inizializzato");
          return;
        }
        if (isVoiceListening) {
          voiceRecognition.stop();
          return;
        }
        try {
          voiceRecognition.start();
        } catch {
          setVoiceMessage("Impossibile avviare il microfono in questo momento");
        }
      });
    }
    function bindKeyboardShortcuts() {
      document.addEventListener("keydown", (e) => {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        switch (e.key) {
          case "?":
            e.preventDefault();
            toggleShortcutHelp();
            break;
          case "r":
            e.preventDefault();
            api.forceRefresh();
            void refreshDashboard();
            setStatusMessage("Dashboard aggiornata (shortcut R)");
            break;
          case "d":
            e.preventDefault();
            currentTheme = cycleTheme(currentTheme);
            applyTheme(currentTheme);
            saveUiPrefs({ filter: currentFilter, theme: currentTheme });
            break;
          case "Escape": {
            const openDialogs = document.querySelectorAll("dialog[open]");
            openDialogs.forEach((d) => d.close());
            const helpEl = document.getElementById("shortcut-help-overlay");
            if (helpEl && !helpEl.hidden) helpEl.hidden = true;
            break;
          }
          case "e":
            e.preventDefault();
            document.getElementById("btn-export-csv")?.click();
            break;
          case "p":
            e.preventDefault();
            printReport();
            break;
        }
      });
    }
    function toggleShortcutHelp() {
      let overlay = document.getElementById("shortcut-help-overlay");
      if (overlay) {
        overlay.hidden = !overlay.hidden;
        return;
      }
      overlay = document.createElement("div");
      overlay.id = "shortcut-help-overlay";
      overlay.className = "shortcut-help-overlay";
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
      overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) overlay.hidden = true;
      });
      document.body.appendChild(overlay);
    }
    function bindLeadSearch() {
      function doSearch(page = 1) {
        const query = document.getElementById("lead-search-input")?.value ?? "";
        const status = document.getElementById("lead-search-status")?.value ?? "";
        const detailEl = document.getElementById("lead-detail-content");
        if (detailEl) detailEl.hidden = true;
        void api.searchLeads(query, status || void 0, void 0, page).then((result) => {
          renderLeadSearchResults(
            result.leads,
            result.total,
            result.page,
            result.pageSize,
            (p) => doSearch(p),
            (leadId) => {
              void api.getLeadDetail(leadId).then((detail) => {
                if (!detail) return;
                const el = document.getElementById("lead-detail-content");
                if (el) {
                  el.hidden = false;
                  renderLeadDetail(detail.lead, detail.timeline);
                }
              });
            }
          );
        }).catch(() => setStatusMessage("Errore ricerca lead"));
      }
      document.getElementById("btn-lead-search")?.addEventListener("click", () => doSearch(1));
      document.getElementById("lead-search-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSearch(1);
      });
    }
    function bindControls() {
      byId("btn-refresh").addEventListener("click", () => {
        api.forceRefresh();
        void refreshDashboard();
      });
      document.getElementById("btn-theme-toggle")?.addEventListener("click", () => {
        currentTheme = cycleTheme(currentTheme);
        applyTheme(currentTheme);
        saveUiPrefs({ filter: currentFilter, theme: currentTheme });
      });
      document.getElementById("btn-export-csv")?.addEventListener("click", () => {
        if (lastTrendData.length === 0) {
          setStatusMessage("Nessun dato trend da esportare");
          return;
        }
        const rows = lastTrendData.map((r) => ({
          date: r.date,
          invites_sent: r.invitesSent,
          messages_sent: r.messagesSent,
          acceptances: r.acceptances,
          run_errors: r.runErrors,
          challenges: r.challenges,
          risk_score: Math.round(r.estimatedRiskScore ?? 0)
        }));
        const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        exportToCSV(rows, `linkedin-bot-trend-${dateStr}.csv`);
        setStatusMessage("Trend CSV esportato");
      });
      document.getElementById("btn-export-chart")?.addEventListener("click", () => {
        const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        downloadCanvasAsPng("chart-invites-daily", `linkedin-bot-chart-${dateStr}.png`);
        setStatusMessage("Grafico PNG scaricato");
      });
      document.getElementById("btn-print")?.addEventListener("click", () => {
        printReport();
      });
      document.getElementById("sse-reconnect")?.addEventListener("click", () => {
        updateSseIndicator("UNKNOWN");
        connectEventStream();
      });
      byId("btn-pause").addEventListener("click", () => {
        byId("pause-modal").showModal();
        byId("pause-minutes-input").focus();
      });
      byId("pause-cancel-btn").addEventListener("click", () => {
        byId("pause-modal").close();
      });
      byId("pause-confirm-btn").addEventListener("click", () => {
        const input = byId("pause-minutes-input");
        const minutes = Number.parseInt(input.value, 10);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) {
          input.setCustomValidity("Inserisci un numero tra 1 e 10080");
          input.reportValidity();
          return;
        }
        input.setCustomValidity("");
        void api.pause(minutes).then((ok) => {
          setStatusMessage(ok ? `Pausa attivata per ${minutes} minuti` : "Errore durante la pausa");
          if (ok) {
            byId("pause-modal").close();
            void refreshDashboard();
          }
        }).catch(() => setStatusMessage("Errore di rete durante la pausa"));
      });
      byId("btn-resume").addEventListener("click", () => {
        void api.resume().then((ok) => {
          setStatusMessage(ok ? "Automazione ripresa" : "Errore durante la ripresa");
          if (ok) {
            void refreshDashboard();
          }
        }).catch(() => setStatusMessage("Errore di rete durante la ripresa"));
      });
      document.getElementById("btn-trigger-run")?.addEventListener("click", () => {
        void api.triggerRun("all").then((ok) => {
          setStatusMessage(ok ? 'Run workflow "all" schedulato per il prossimo ciclo' : "Errore trigger run");
        }).catch(() => setStatusMessage("Errore di rete trigger run"));
      });
      byId("btn-resolve-selected").addEventListener("click", () => {
        void resolveSelectedIncidents().then((report) => {
          if (report.total === 0) {
            setStatusMessage("Nessun incidente selezionato");
            return;
          }
          setStatusMessage(`Incidenti risolti: ${report.resolved}/${report.total}`);
          void refreshDashboard();
        }).catch(() => setStatusMessage("Errore di rete durante la risoluzione"));
      });
      byId("incidents-tbody").addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.classList.contains("incident-select")) {
          return;
        }
        const id = Number.parseInt(target.dataset.incidentId ?? "", 10);
        if (!Number.isFinite(id)) return;
        if (target.checked) {
          selectedIncidentIds.add(id);
        } else {
          selectedIncidentIds.delete(id);
        }
      });
      byId("incidents-tbody").addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || !target.classList.contains("incident-resolve")) {
          return;
        }
        const id = Number.parseInt(target.dataset.incidentId ?? "", 10);
        if (!Number.isFinite(id)) return;
        void api.resolveIncident(id).then((ok) => {
          setStatusMessage(ok ? `Incidente #${id} risolto` : `Errore risoluzione #${id}`);
          if (ok) {
            selectedIncidentIds.delete(id);
            void refreshDashboard();
          }
        }).catch(() => setStatusMessage(`Errore di rete risoluzione #${id}`));
      });
      byId("comment-suggestions-tbody").addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        const leadId = Number.parseInt(target.dataset.leadId ?? "", 10);
        const suggestionIndex = Number.parseInt(target.dataset.suggestionIndex ?? "", 10);
        if (!Number.isFinite(leadId) || !Number.isFinite(suggestionIndex)) {
          return;
        }
        if (target.classList.contains("comment-suggestion-approve")) {
          const row = target.closest("tr");
          const editor = row?.querySelector("textarea.comment-suggestion-editor");
          const comment = editor?.value ?? "";
          void api.approveCommentSuggestion(leadId, suggestionIndex, comment).then((ok) => {
            setStatusMessage(ok ? `Bozza approvata (lead #${leadId})` : `Errore approvazione bozza (lead #${leadId})`);
            if (ok) {
              void refreshDashboard();
            }
          }).catch(() => setStatusMessage(`Errore di rete approvazione bozza (lead #${leadId})`));
          return;
        }
        if (target.classList.contains("comment-suggestion-reject")) {
          void api.rejectCommentSuggestion(leadId, suggestionIndex).then((ok) => {
            setStatusMessage(ok ? `Bozza rifiutata (lead #${leadId})` : `Errore rifiuto bozza (lead #${leadId})`);
            if (ok) {
              void refreshDashboard();
            }
          }).catch(() => setStatusMessage(`Errore di rete rifiuto bozza (lead #${leadId})`));
        }
      });
      ["timeline-filter-type", "timeline-filter-account", "timeline-filter-list"].forEach((id) => {
        byId(id).addEventListener("change", () => {
          currentFilter = readTimelineFilter();
          saveUiPrefs({ filter: currentFilter, theme: currentTheme });
          renderTimelineSection();
        });
      });
      document.addEventListener("visibilitychange", () => {
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
    function restoreFilterSelects() {
      const selects = [
        ["timeline-filter-type", "type"],
        ["timeline-filter-account", "accountId"],
        ["timeline-filter-list", "listName"]
      ];
      for (const [id, key] of selects) {
        const el = document.getElementById(id);
        if (el && currentFilter[key] !== "all") {
          el.value = currentFilter[key];
        }
      }
    }
    function registerServiceWorker() {
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.register("/sw.js").catch(() => {
        });
      }
    }
    async function bootstrap() {
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
  }
});
export default require_main();
//# sourceMappingURL=bundle.js.map
