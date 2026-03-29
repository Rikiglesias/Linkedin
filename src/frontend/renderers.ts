import { byId, clearChildren, createCell, formatDate, formatPercent, setText } from './dom';
import {
    AbLeaderboardRow,
    CampaignRunRecord,
    CommentSuggestionQueueResponse,
    IncidentRecord,
    KpiResponse,
    LeadSearchRecord,
    LeadTimelineEvent,
    OperationalSloSnapshot,
    PredictiveRiskResponse,
    ProxyPoolSnapshot,
    ReviewQueueResponse,
    SelectorCacheKpiSnapshot,
    TimelineEntry,
    TimingSlotRow,
    TrendRow,
} from './types';

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
    riskNode.className =
        riskValue >= 80 ? 'kpi-value risk-high' : riskValue >= 50 ? 'kpi-value risk-medium' : 'kpi-value risk-low';

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

function formatSloPercent(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '0.0%';
    return `${(value * 100).toFixed(1)}%`;
}

export function renderOperationalSlo(slo: OperationalSloSnapshot | undefined): void {
    if (!slo) {
        setText('slo-current-status', 'SLO corrente: —');
        setText('slo-7d-status', 'SLO 7d: —');
        setText('slo-30d-status', 'SLO 30d: —');
        return;
    }

    const current = slo.current ?? { status: 'OK', queueLagSeconds: 0, oldestRunningJobSeconds: 0 };
    setText(
        'slo-current-status',
        `SLO corrente: ${slo.status} (queueLag ${Math.round(current.queueLagSeconds ?? 0)}s, running ${Math.round(current.oldestRunningJobSeconds ?? 0)}s)`,
    );

    const window7d = (slo.windows ?? []).find((row) => row.windowDays === 7);
    const window30d = (slo.windows ?? []).find((row) => row.windowDays === 30);
    setText(
        'slo-7d-status',
        window7d
            ? `SLO 7d: ${window7d.status} (err ${formatSloPercent(window7d.errorRate)}, chall ${formatSloPercent(window7d.challengeRate)}, sel ${formatSloPercent(window7d.selectorFailureRate)})`
            : 'SLO 7d: —',
    );
    setText(
        'slo-30d-status',
        window30d
            ? `SLO 30d: ${window30d.status} (err ${formatSloPercent(window30d.errorRate)}, chall ${formatSloPercent(window30d.challengeRate)}, sel ${formatSloPercent(window30d.selectorFailureRate)})`
            : 'SLO 30d: —',
    );
}

export function renderSelectorCacheKpi(kpi: SelectorCacheKpiSnapshot | undefined): void {
    if (!kpi) {
        setText('selector-cache-kpi', 'Selector cache KPI: —');
        return;
    }
    const reduction = kpi.reductionPct === null ? 'n/a' : `${kpi.reductionPct.toFixed(1)}%`;
    const target = `${(kpi.targetReductionRate * 100).toFixed(0)}%`;
    const status =
        kpi.validationStatus === 'PASS' ? 'PASS' : kpi.validationStatus === 'WARN' ? 'WARN' : 'INSUFFICIENT_DATA';
    const baselineNote = kpi.validationStatus === 'INSUFFICIENT_DATA' ? `, baseline<${kpi.minBaselineFailures}` : '';
    setText(
        'selector-cache-kpi',
        `Selector cache KPI 7d: ${status} (riduzione ${reduction}, target ${target}, fail ${kpi.currentFailures}/${kpi.previousFailures}${baselineNote})`,
    );
}

export function renderProxyHealth(pool: ProxyPoolSnapshot | undefined): void {
    const el = document.getElementById('proxy-health');
    if (!el) return;

    if (!pool || !pool.configured) {
        el.textContent = 'Proxy: non configurato';
        return;
    }

    const failed = pool.total - pool.ready - pool.cooling;
    const healthPct = pool.total > 0 ? Math.round((pool.ready / pool.total) * 100) : 0;
    const statusClass = healthPct >= 80 ? 'pill-ok' : healthPct >= 50 ? 'pill-warn' : 'pill-critical';
    el.innerHTML = '';
    const pill = statusPill(`${healthPct}%`, statusClass);
    el.appendChild(pill);
    el.appendChild(
        document.createTextNode(
            ` Proxy: ${pool.ready}/${pool.total} pronti, ${pool.cooling} in cooldown, ${failed < 0 ? 0 : failed} falliti (mobile: ${pool.mobile}, residential: ${pool.residential})`,
        ),
    );
}

export function renderSessionTimer(startedAt: string | null | undefined): void {
    const el = document.getElementById('session-timer');
    if (!el) return;

    if (!startedAt) {
        el.textContent = 'Browser: inattivo';
        el.classList.remove('session-timer-warning');
        return;
    }

    const startMs = Date.parse(startedAt);
    if (!Number.isFinite(startMs)) {
        el.textContent = 'Browser: inattivo';
        return;
    }

    const elapsedMs = Date.now() - startMs;
    const minutes = Math.floor(elapsedMs / 60000);
    const isLong = minutes >= 45;

    el.textContent = `Browser: attivo da ${minutes} min${isLong ? ' — considera di chiudere la sessione' : ''}`;
    if (isLong) {
        el.classList.add('session-timer-warning');
    } else {
        el.classList.remove('session-timer-warning');
    }
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
        const severityClass =
            incident.severity === 'CRITICAL'
                ? 'pill-danger'
                : incident.severity === 'WARN'
                  ? 'pill-warning'
                  : 'pill-info';
        severityCell.appendChild(statusPill(incident.severity, severityClass));

        const detailsCell = document.createElement('td');
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Dettagli';
        const pre = document.createElement('pre');
        pre.className = 'incident-details';
        pre.textContent =
            incident.details_json && incident.details_json.trim().length > 0
                ? incident.details_json
                : 'Nessun dettaglio disponibile';
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
    queueCountNode.className =
        (reviewQueue.reviewLeadCount ?? 0) > 0 ? 'conv-value system-warn' : 'conv-value system-ok';

    const incidentsNode = byId<HTMLElement>('review-queue-incidents');
    incidentsNode.className =
        (reviewQueue.challengeIncidentCount ?? 0) > 0 ? 'conv-value system-danger' : 'conv-value system-ok';

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

export function renderCommentSuggestions(queue: CommentSuggestionQueueResponse): void {
    const rows = queue.rows ?? [];
    setText('comment-suggestions-count', rows.length > 0 ? `${rows.length} in review` : 'Nessuna bozza in review');
    const tbody = byId<HTMLTableSectionElement>('comment-suggestions-tbody');
    clearChildren(tbody);

    if (rows.length === 0) {
        const row = document.createElement('tr');
        const cell = createCell('Nessun suggerimento commento da revisionare', 'empty-state');
        cell.colSpan = 6;
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of rows) {
        const row = document.createElement('tr');

        const leadCell = document.createElement('td');
        const leadLink = document.createElement('a');
        leadLink.href = item.linkedinUrl;
        leadLink.target = '_blank';
        leadLink.rel = 'noopener noreferrer';
        leadLink.textContent = `${item.firstName} ${item.lastName}`.trim() || `Lead #${item.leadId}`;
        leadCell.appendChild(leadLink);

        const postPreview = item.postSnippet?.trim().length > 0 ? item.postSnippet : 'Post non disponibile';

        const commentCell = document.createElement('td');
        const editor = document.createElement('textarea');
        editor.className = 'comment-suggestion-editor';
        editor.value = item.comment ?? '';
        editor.dataset.leadId = String(item.leadId);
        editor.dataset.suggestionIndex = String(item.suggestionIndex);
        editor.maxLength = 280;
        commentCell.appendChild(editor);

        const actionsCell = document.createElement('td');
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'comment-suggestion-actions';
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.className = 'btn btn-sm btn-success comment-suggestion-approve';
        approveButton.dataset.leadId = String(item.leadId);
        approveButton.dataset.suggestionIndex = String(item.suggestionIndex);
        approveButton.textContent = 'Approva';
        const rejectButton = document.createElement('button');
        rejectButton.type = 'button';
        rejectButton.className = 'btn btn-sm btn-danger comment-suggestion-reject';
        rejectButton.dataset.leadId = String(item.leadId);
        rejectButton.dataset.suggestionIndex = String(item.suggestionIndex);
        rejectButton.textContent = 'Rifiuta';
        actionsWrap.appendChild(approveButton);
        actionsWrap.appendChild(rejectButton);
        actionsCell.appendChild(actionsWrap);

        row.appendChild(leadCell);
        row.appendChild(createCell(item.listName || 'default'));
        row.appendChild(createCell(postPreview));
        row.appendChild(commentCell);
        row.appendChild(createCell(`${Math.round((item.confidence ?? 0) * 100)}%`));
        row.appendChild(actionsCell);
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
        const sent = item.totalSent ?? item.sent ?? 0;
        const score = item.bayesScore ?? item.ucbScore ?? 0;
        const winnerSuffix = item.significanceWinner ? ' [WIN]' : '';
        row.appendChild(createCell(`${variantPrefix}${item.variantId}${winnerSuffix}`));
        row.appendChild(createCell(String(sent)));
        row.appendChild(createCell(formatPercent(item.accepted ?? 0, sent)));
        row.appendChild(createCell(formatPercent(item.replied ?? 0, sent)));
        row.appendChild(createCell(score.toFixed(3)));
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
    optionSets: { types: string[]; accountIds: string[]; listNames: string[] },
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

// ─── Lead Search ──────────────────────────────────────────────────────────────

export function renderLeadSearchResults(
    leads: LeadSearchRecord[],
    total: number,
    page: number,
    pageSize: number,
    onPageChange: (page: number) => void,
    onLeadClick: (id: number) => void,
): void {
    const tbody = byId<HTMLTableSectionElement>('lead-search-tbody');
    const info = byId<HTMLElement>('lead-search-info');
    const pager = byId<HTMLElement>('lead-search-pager');
    clearChildren(tbody);
    clearChildren(pager);

    if (leads.length === 0) {
        info.textContent = total === 0 ? 'Nessun risultato' : 'Caricamento...';
        return;
    }

    const totalPages = Math.ceil(total / pageSize);
    info.textContent = `${total} lead trovati — Pagina ${page}/${totalPages}`;

    for (const lead of leads) {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => onLeadClick(lead.id));

        const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '—';
        tr.appendChild(createCell(fullName));
        tr.appendChild(createCell(lead.account_name ?? '—'));
        tr.appendChild(createCell(lead.job_title ?? '—'));

        const statusTd = document.createElement('td');
        statusTd.appendChild(statusPill(lead.status, `pill-${lead.status.toLowerCase()}`));
        tr.appendChild(statusTd);

        tr.appendChild(createCell(lead.list_name ?? '—'));
        tr.appendChild(
            createCell(lead.lead_score !== null && lead.lead_score !== undefined ? String(lead.lead_score) : '—'),
        );
        tr.appendChild(createCell(lead.updated_at ? formatDate(lead.updated_at) : '—'));
        tbody.appendChild(tr);
    }

    if (totalPages > 1) {
        if (page > 1) {
            const prev = document.createElement('button');
            prev.textContent = '← Precedente';
            prev.className = 'btn btn-small';
            prev.addEventListener('click', () => onPageChange(page - 1));
            pager.appendChild(prev);
        }
        const span = document.createElement('span');
        span.textContent = ` ${page} / ${totalPages} `;
        span.style.margin = '0 0.5rem';
        pager.appendChild(span);
        if (page < totalPages) {
            const next = document.createElement('button');
            next.textContent = 'Successiva →';
            next.className = 'btn btn-small';
            next.addEventListener('click', () => onPageChange(page + 1));
            pager.appendChild(next);
        }
    }
}

export function renderLeadDetail(lead: LeadSearchRecord, timeline: LeadTimelineEvent[]): void {
    const container = byId<HTMLElement>('lead-detail-content');
    clearChildren(container);

    const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';

    const header = document.createElement('h3');
    header.textContent = fullName;
    container.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'lead-detail-meta';
    meta.innerHTML = `
        <p><strong>Azienda:</strong> ${lead.account_name ?? '—'}</p>
        <p><strong>Titolo:</strong> ${lead.job_title ?? '—'}</p>
        <p><strong>Stato:</strong> ${lead.status}</p>
        <p><strong>Lista:</strong> ${lead.list_name ?? '—'}</p>
        <p><strong>Score:</strong> ${lead.lead_score ?? '—'}</p>
        <p><strong>Email:</strong> ${lead.email ?? '—'}</p>
        <p><strong>LinkedIn:</strong> <a href="${lead.linkedin_url}" target="_blank" rel="noopener">${lead.linkedin_url}</a></p>
    `;
    container.appendChild(meta);

    if (timeline.length > 0) {
        const timelineHeader = document.createElement('h4');
        timelineHeader.textContent = 'Timeline';
        timelineHeader.style.marginTop = '1rem';
        container.appendChild(timelineHeader);

        const table = document.createElement('table');
        table.className = 'compact-table';
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr><th>Da</th><th>A</th><th>Motivo</th><th>Data</th></tr>';
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const evt of timeline) {
            const tr = document.createElement('tr');
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
