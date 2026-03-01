import { byId, clearChildren, createCell, formatDate, formatPercent, setText } from './dom';
import { AbLeaderboardRow, CampaignRunRecord, IncidentRecord, KpiResponse, ReviewQueueResponse, TimelineEntry, TimingSlotRow, TrendRow, PredictiveRiskResponse } from './types';

function statusPill(text: string, className: string): HTMLSpanElement {
    const pill = document.createElement('span');
    pill.className = `pill ${className}`;
    pill.textContent = text;
    return pill;
}

function updateSystemBadge(system: KpiResponse['system']): void {
    const badge = byId<HTMLElement>('status-badge');
    const text = byId<HTMLElement>('status-text');
    badge.className = 'status-badge';

    if (system.quarantined) {
        badge.classList.add('status-quarantine');
        text.textContent = 'Quarantena attiva';
        return;
    }

    if (system.pausedUntil) {
        badge.classList.add('status-paused');
        text.textContent = `Pausato fino alle ${new Date(system.pausedUntil).toLocaleTimeString('it-IT', { hour12: false })}`;
        return;
    }

    badge.classList.add('status-running');
    text.textContent = 'Operativo';
}

export function renderKpis(kpis: KpiResponse): void {
    const funnel = kpis.funnel ?? {
        totalLeads: 0,
        invited: 0,
        accepted: 0,
        readyMessage: 0,
        messaged: 0,
        replied: 0,
    };

    setText('val-invited', String(funnel.invited ?? 0));
    setText('val-accepted', String(funnel.accepted ?? 0));
    setText('val-messaged', String(funnel.messaged ?? 0));
    setText('val-replied', String(funnel.replied ?? 0));
    setText('val-total', String(funnel.totalLeads ?? 0));
    setText('val-ready-message', String(funnel.readyMessage ?? 0));

    const riskValue = Math.round(Number(kpis.risk?.score ?? 0));
    const riskNode = byId<HTMLElement>('val-risk');
    riskNode.textContent = String(riskValue);
    riskNode.className = riskValue >= 80 ? 'kpi-value risk-high' : riskValue >= 50 ? 'kpi-value risk-medium' : 'kpi-value risk-low';

    setText('conv-accept', formatPercent(funnel.accepted ?? 0, funnel.invited ?? 0));
    setText('conv-reply', formatPercent(funnel.replied ?? 0, funnel.invited ?? 0));
    setText('conv-msg-reply', formatPercent(funnel.replied ?? 0, funnel.messaged ?? 0));

    const systemState = byId<HTMLElement>('system-state');
    if (kpis.system.quarantined) {
        systemState.textContent = 'Quarantena';
        systemState.className = 'conv-value system-danger';
    } else if (kpis.system.pausedUntil) {
        systemState.textContent = 'Pausato';
        systemState.className = 'conv-value system-warn';
    } else {
        systemState.textContent = 'Stabile';
        systemState.className = 'conv-value system-ok';
    }

    updateSystemBadge(kpis.system);
}

export function renderKpiComparison(trend: TrendRow[]): void {
    if (trend.length === 0) {
        setText('kpi-compare-invites', '—');
        setText('kpi-compare-messages', '—');
        setText('kpi-compare-accept', '—');
        setText('kpi-compare-errors', '—');
        return;
    }

    const latest = trend[trend.length - 1];
    const history = trend.slice(0, -1);
    const avg = (values: number[]): number => {
        if (values.length === 0) return 0;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const weekInvites = avg(history.map((item) => item.invitesSent));
    const weekMessages = avg(history.map((item) => item.messagesSent));
    const weekAccept = avg(history.map((item) => item.acceptances));
    const weekErrors = avg(history.map((item) => item.runErrors));

    setText('kpi-compare-invites', `${latest.invitesSent} oggi / ${weekInvites.toFixed(1)} media`);
    setText('kpi-compare-messages', `${latest.messagesSent} oggi / ${weekMessages.toFixed(1)} media`);
    setText('kpi-compare-accept', `${latest.acceptances} oggi / ${weekAccept.toFixed(1)} media`);
    setText('kpi-compare-errors', `${latest.runErrors} oggi / ${weekErrors.toFixed(1)} media`);

    const trendBody = byId<HTMLTableSectionElement>('trend-tbody');
    clearChildren(trendBody);
    const fragment = document.createDocumentFragment();
    for (const row of trend.slice().reverse()) {
        const tr = document.createElement('tr');
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

export function renderPredictiveRisk(predictive: PredictiveRiskResponse): void {
    const statusEl = byId<HTMLElement>('risk-predictive-status');
    const detailEl = byId<HTMLElement>('risk-predictive-detail');

    if (!predictive.enabled) {
        statusEl.textContent = 'Disabilitato';
        statusEl.className = 'conv-value';
        detailEl.textContent = '—';
        return;
    }

    if (!predictive.alerts || predictive.alerts.length === 0) {
        statusEl.textContent = 'Normale';
        statusEl.className = 'conv-value system-ok';
        detailEl.textContent = `Baseline ${predictive.lookbackDays}g`;
        return;
    }

    const top = predictive.alerts[0];
    statusEl.textContent = 'Anomalia';
    statusEl.className = 'conv-value system-danger';
    detailEl.textContent = `${top.metric} z=${Number(top.zScore ?? 0).toFixed(2)}`;
}

export function renderIncidents(incidents: IncidentRecord[], selectedIds: Set<number>): void {
    setText('incidents-count', incidents.length === 0 ? 'Nessun incidente aperto' : `${incidents.length} aperti`);
    const tbody = byId<HTMLTableSectionElement>('incidents-tbody');
    clearChildren(tbody);

    if (incidents.length === 0) {
        const row = document.createElement('tr');
        const cell = createCell('Nessun incidente aperto', 'empty-state');
        cell.colSpan = 6;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const incident of incidents) {
        const row = document.createElement('tr');

        const selection = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'incident-select';
        checkbox.dataset.incidentId = String(incident.id);
        checkbox.checked = selectedIds.has(incident.id);
        selection.appendChild(checkbox);

        const typeCell = createCell(incident.type);
        const severityCell = document.createElement('td');
        const severityClass = incident.severity === 'CRITICAL' ? 'pill-danger' : incident.severity === 'WARN' ? 'pill-warning' : 'pill-info';
        severityCell.appendChild(statusPill(incident.severity, severityClass));

        const detailsCell = document.createElement('td');
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Dettagli';
        const pre = document.createElement('pre');
        pre.className = 'incident-details';
        pre.textContent = incident.details_json && incident.details_json.trim().length > 0 ? incident.details_json : 'Nessun dettaglio disponibile';
        details.appendChild(summary);
        details.appendChild(pre);
        detailsCell.appendChild(details);

        const actionCell = document.createElement('td');
        const resolveButton = document.createElement('button');
        resolveButton.type = 'button';
        resolveButton.className = 'btn btn-sm btn-success incident-resolve';
        resolveButton.dataset.incidentId = String(incident.id);
        resolveButton.textContent = 'Risolvi';
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

export function renderReviewQueue(reviewQueue: ReviewQueueResponse): void {
    setText('review-queue-count', String(reviewQueue.reviewLeadCount ?? 0));
    setText('review-queue-incidents', String(reviewQueue.challengeIncidentCount ?? 0));

    const queueCountNode = byId<HTMLElement>('review-queue-count');
    queueCountNode.className = (reviewQueue.reviewLeadCount ?? 0) > 0 ? 'conv-value system-warn' : 'conv-value system-ok';

    const incidentsNode = byId<HTMLElement>('review-queue-incidents');
    incidentsNode.className = (reviewQueue.challengeIncidentCount ?? 0) > 0 ? 'conv-value system-danger' : 'conv-value system-ok';

    const tbody = byId<HTMLTableSectionElement>('review-tbody');
    clearChildren(tbody);

    if (!reviewQueue.leads || reviewQueue.leads.length === 0) {
        const row = document.createElement('tr');
        const cell = createCell('Nessun lead in review', 'empty-state');
        cell.colSpan = 6;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const lead of reviewQueue.leads) {
        const row = document.createElement('tr');
        const priority = /challenge|captcha|block/i.test(lead.lastError ?? '') ? 'Alta' : 'Media';

        const nameCell = document.createElement('td');
        nameCell.textContent = `${lead.firstName} ${lead.lastName}`.trim();

        const actionCell = document.createElement('td');
        const profileButton = document.createElement('a');
        profileButton.className = 'btn btn-sm btn-secondary';
        profileButton.href = lead.linkedinUrl;
        profileButton.target = '_blank';
        profileButton.rel = 'noopener noreferrer';
        profileButton.textContent = 'Apri profilo';
        actionCell.appendChild(profileButton);

        row.appendChild(createCell(String(lead.id)));
        row.appendChild(nameCell);
        row.appendChild(createCell(lead.listName || 'default'));
        row.appendChild(createCell(priority));
        row.appendChild(createCell(lead.lastError ?? 'Verifica stato su LinkedIn'));
        row.appendChild(actionCell);
        fragment.appendChild(row);
    }

    tbody.appendChild(fragment);
}

export function renderRuns(runs: CampaignRunRecord[]): void {
    const tbody = byId<HTMLTableSectionElement>('runs-tbody');
    clearChildren(tbody);

    if (runs.length === 0) {
        const row = document.createElement('tr');
        const cell = createCell('Nessun run recente', 'empty-state');
        cell.colSpan = 7;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const run of runs) {
        const row = document.createElement('tr');
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

export function renderAbLeaderboard(rows: AbLeaderboardRow[]): void {
    const tbody = byId<HTMLTableSectionElement>('ab-tbody');
    clearChildren(tbody);

    if (rows.length === 0) {
        const row = document.createElement('tr');
        const cell = createCell('Nessun dato A/B disponibile', 'empty-state');
        cell.colSpan = 6;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((item, index) => {
        const row = document.createElement('tr');
        const variantPrefix = index === 0 ? '1° ' : index === 1 ? '2° ' : index === 2 ? '3° ' : '';
        row.appendChild(createCell(`${variantPrefix}${item.variantId}`));
        row.appendChild(createCell(String(item.totalSent ?? 0)));
        row.appendChild(createCell(formatPercent(item.accepted ?? 0, item.totalSent ?? 0)));
        row.appendChild(createCell(formatPercent(item.replied ?? 0, item.totalSent ?? 0)));
        row.appendChild(createCell((item.ucbScore ?? 0).toFixed(3)));
        fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
}

export function renderTimingSlots(slots: TimingSlotRow[]): void {
    const list = byId<HTMLDivElement>('timing-list');
    clearChildren(list);

    if (slots.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Nessun dato timing disponibile';
        list.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    slots.forEach((slot, index) => {
        const item = document.createElement('div');
        item.className = 'timing-slot';

        const rank = document.createElement('span');
        rank.className = 'timing-rank';
        rank.textContent = String(index + 1);

        const label = document.createElement('span');
        label.className = 'timing-label';
        label.textContent = `${slot.hour}:00 - score ${slot.score.toFixed(2)} (${slot.samples} campioni)`;

        item.appendChild(rank);
        item.appendChild(label);
        fragment.appendChild(item);
    });

    list.appendChild(fragment);
}

export function renderTimeline(
    entries: TimelineEntry[],
    optionSets: { types: string[]; accountIds: string[]; listNames: string[] }
): void {
    const timelineList = byId<HTMLDivElement>('timeline-list');
    clearChildren(timelineList);

    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Nessun evento realtime disponibile';
        timelineList.appendChild(empty);
    } else {
        const fragment = document.createDocumentFragment();
        for (const entry of entries.slice(0, 150)) {
            const article = document.createElement('article');
            article.className = 'timeline-item';

            const header = document.createElement('div');
            header.className = 'timeline-head';
            header.textContent = `${formatDate(entry.timestamp)} · ${entry.type}`;

            const summary = document.createElement('div');
            summary.className = 'timeline-summary';
            summary.textContent = entry.summary;

            const meta = document.createElement('div');
            meta.className = 'timeline-meta';
            meta.textContent = `account=${entry.accountId ?? 'n/a'} · list=${entry.listName ?? 'n/a'}`;

            article.appendChild(header);
            article.appendChild(summary);
            article.appendChild(meta);
            fragment.appendChild(article);
        }
        timelineList.appendChild(fragment);
    }

    populateSelect('timeline-filter-type', optionSets.types);
    populateSelect('timeline-filter-account', optionSets.accountIds);
    populateSelect('timeline-filter-list', optionSets.listNames);
}

function populateSelect(id: string, values: string[]): void {
    const select = byId<HTMLSelectElement>(id);
    const previousValue = select.value;
    clearChildren(select);

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All';
    select.appendChild(allOption);

    values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });

    if (previousValue && (previousValue === 'all' || values.includes(previousValue))) {
        select.value = previousValue;
    } else {
        select.value = 'all';
    }
}
