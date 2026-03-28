import { getDatabase } from '../../db';
import { logWarn } from '../../telemetry/logger';
import { LeadRecord, LeadStatus } from '../../types/domain';
import { normalizeLinkedInUrl } from '../../linkedinUrl';
import {
    type AddLeadInput,
    type AddCompanyTargetInput,
    type ApplyControlPlaneCampaignResult,
    type CompanyTargetRecord,
    type CompanyTargetStatus,
    type ControlPlaneCampaignConfigInput,
    type LeadListCampaignConfig,
    type LeadListRow,
    type ListLeadStatusCount,
    type SalesNavListRecord,
    type SalesNavListSummary,
    type UpdateLeadLinkedinUrlResult,
    type UpdateLeadListCampaignInput,
    type UpsertSalesNavigatorLeadInput,
    type UpsertSalesNavigatorLeadResult,
} from '../repositories.types';
import { LEAD_SELECT_COLUMNS } from './sqlColumns';
import { mergedLeadValue, normalizeLegacyStatus, normalizeTextValue, withTransaction } from './shared';

function normalizeLeadListRow(row: LeadListRow): LeadListCampaignConfig {
    return {
        name: row.name,
        source: row.source,
        isActive: row.is_active === 1,
        priority: row.priority,
        dailyInviteCap: row.daily_invite_cap,
        dailyMessageCap: row.daily_message_cap,
        scoringCriteria: row.scoring_criteria ?? null,
        createdAt: row.created_at,
    };
}

export async function getListScoringCriteria(listName: string): Promise<string | null> {
    const db = await getDatabase();
    const row = await db.get<{ scoring_criteria: string | null }>(
        `SELECT scoring_criteria FROM lead_lists WHERE name = ? LIMIT 1`,
        [listName],
    );
    return row?.scoring_criteria ?? null;
}

export async function ensureLeadList(listName: string): Promise<void> {
    const db = await getDatabase();
    await db.run(`INSERT OR IGNORE INTO lead_lists (name, source) VALUES (?, 'import')`, [listName]);
}

export async function syncLeadListsFromLeads(): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT OR IGNORE INTO lead_lists (name, source)
        SELECT DISTINCT list_name, 'legacy'
        FROM leads
        WHERE TRIM(COALESCE(list_name, '')) <> ''
    `,
    );
}

export async function listLeadCampaignConfigs(onlyActive: boolean = false): Promise<LeadListCampaignConfig[]> {
    const db = await getDatabase();
    const rows = onlyActive
        ? await db.query<LeadListRow>(
            `
            SELECT name, source, is_active, priority, daily_invite_cap, daily_message_cap, scoring_criteria, created_at
            FROM lead_lists
            WHERE is_active = 1
            ORDER BY priority ASC, created_at ASC, name ASC
        `,
        )
        : await db.query<LeadListRow>(
            `
            SELECT name, source, is_active, priority, daily_invite_cap, daily_message_cap, scoring_criteria, created_at
            FROM lead_lists
            ORDER BY is_active DESC, priority ASC, created_at ASC, name ASC
        `,
        );

    return rows.map(normalizeLeadListRow);
}

export async function updateLeadCampaignConfig(
    listName: string,
    patch: UpdateLeadListCampaignInput,
): Promise<LeadListCampaignConfig> {
    await ensureLeadList(listName);

    const setParts: string[] = [];
    const params: unknown[] = [];

    if (Object.prototype.hasOwnProperty.call(patch, 'isActive')) {
        setParts.push('is_active = ?');
        params.push(patch.isActive ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
        setParts.push('priority = ?');
        params.push(Math.max(1, patch.priority ?? 100));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'dailyInviteCap')) {
        setParts.push('daily_invite_cap = ?');
        params.push(patch.dailyInviteCap === null ? null : Math.max(0, patch.dailyInviteCap ?? 0));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'dailyMessageCap')) {
        setParts.push('daily_message_cap = ?');
        params.push(patch.dailyMessageCap === null ? null : Math.max(0, patch.dailyMessageCap ?? 0));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'scoringCriteria')) {
        setParts.push('scoring_criteria = ?');
        params.push(patch.scoringCriteria ?? null);
    }

    if (setParts.length > 0) {
        const db = await getDatabase();
        await db.run(
            `
            UPDATE lead_lists
            SET ${setParts.join(', ')}
            WHERE name = ?
        `,
            [...params, listName],
        );
    }

    const configs = await listLeadCampaignConfigs(false);
    const updated = configs.find((config) => config.name === listName);
    if (!updated) {
        throw new Error(`Configurazione lista ${listName} non trovata dopo update.`);
    }
    return updated;
}

export async function applyControlPlaneCampaignConfigs(
    configs: ControlPlaneCampaignConfigInput[],
): Promise<ApplyControlPlaneCampaignResult> {
    const result: ApplyControlPlaneCampaignResult = {
        fetched: configs.length,
        applied: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedInvalid: 0,
    };

    if (configs.length === 0) {
        return result;
    }

    const db = await getDatabase();
    await withTransaction(db, async () => {
        for (const configItem of configs) {
            const listName = configItem.name.trim();
            if (!listName) {
                result.skippedInvalid += 1;
                continue;
            }

            const nextIsActive = configItem.isActive ? 1 : 0;
            const nextPriority = Math.max(1, Math.floor(configItem.priority));
            const nextInviteCap =
                configItem.dailyInviteCap === null ? null : Math.max(0, Math.floor(configItem.dailyInviteCap));
            const nextMessageCap =
                configItem.dailyMessageCap === null ? null : Math.max(0, Math.floor(configItem.dailyMessageCap));

            const existing = await db.get<LeadListRow>(
                `
                SELECT name, source, is_active, priority, daily_invite_cap, daily_message_cap, scoring_criteria, created_at
                FROM lead_lists
                WHERE name = ?
                LIMIT 1
            `,
                [listName],
            );

            if (!existing) {
                await db.run(
                    `
                    INSERT INTO lead_lists (name, source, is_active, priority, daily_invite_cap, daily_message_cap)
                    VALUES (?, 'control_plane', ?, ?, ?, ?)
                `,
                    [listName, nextIsActive, nextPriority, nextInviteCap, nextMessageCap],
                );
                result.created += 1;
                result.applied += 1;
                continue;
            }

            const changed =
                existing.source !== 'control_plane' ||
                existing.is_active !== nextIsActive ||
                existing.priority !== nextPriority ||
                existing.daily_invite_cap !== nextInviteCap ||
                existing.daily_message_cap !== nextMessageCap;

            if (!changed) {
                result.unchanged += 1;
                continue;
            }

            await db.run(
                `
                UPDATE lead_lists
                SET source = 'control_plane',
                    is_active = ?,
                    priority = ?,
                    daily_invite_cap = ?,
                    daily_message_cap = ?
                WHERE name = ?
            `,
                [nextIsActive, nextPriority, nextInviteCap, nextMessageCap, listName],
            );
            result.updated += 1;
            result.applied += 1;
        }
    });

    return result;
}

export async function upsertSalesNavList(name: string, url: string): Promise<SalesNavListRecord> {
    const db = await getDatabase();
    const normalizedName = name.trim();
    const normalizedUrl = normalizeLinkedInUrl(url.trim());
    if (!normalizedName || !normalizedUrl) {
        throw new Error('upsertSalesNavList: name/url mancanti');
    }

    await db.run(
        `
        INSERT INTO salesnav_lists (name, url)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET
            url = excluded.url,
            updated_at = CURRENT_TIMESTAMP
    `,
        [normalizedName, normalizedUrl],
    );

    const row = await db.get<SalesNavListRecord>(
        `SELECT id, name, url, last_synced_at, created_at, updated_at FROM salesnav_lists WHERE name = ?`,
        [normalizedName],
    );
    if (!row) {
        throw new Error(`Lista SalesNav non trovata dopo upsert: ${normalizedName}`);
    }
    return row;
}

export async function markSalesNavListSynced(listId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE salesnav_lists
        SET last_synced_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [listId],
    );
}

export async function linkLeadToSalesNavList(listId: number, leadId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT OR IGNORE INTO salesnav_list_items (list_id, lead_id)
        VALUES (?, ?)
    `,
        [listId, leadId],
    );
}

export async function listSalesNavLists(limit: number = 200): Promise<SalesNavListSummary[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, limit);
    return db.query<SalesNavListSummary>(
        `
        SELECT
            l.id,
            l.name,
            l.url,
            l.last_synced_at,
            l.created_at,
            l.updated_at,
            COUNT(i.id) as leads_count
        FROM salesnav_lists l
        LEFT JOIN salesnav_list_items i ON i.list_id = l.id
        GROUP BY l.id, l.name, l.url, l.last_synced_at, l.created_at, l.updated_at
        ORDER BY
            CASE WHEN l.last_synced_at IS NULL THEN 0 ELSE 1 END ASC,
            l.last_synced_at ASC,
            l.name ASC
        LIMIT ?
    `,
        [safeLimit],
    );
}

export async function getSalesNavListByName(name: string): Promise<SalesNavListRecord | null> {
    const db = await getDatabase();
    const normalizedName = name.trim();
    if (!normalizedName) return null;
    const row = await db.get<SalesNavListRecord>(
        `SELECT id, name, url, last_synced_at, created_at, updated_at FROM salesnav_lists WHERE name = ? LIMIT 1`,
        [normalizedName],
    );
    return row ?? null;
}

export async function addLead(input: AddLeadInput): Promise<boolean> {
    const db = await getDatabase();
    await ensureLeadList(input.listName);
    const normalizedLinkedinUrl = normalizeLinkedInUrl(input.linkedinUrl);

    const result = await db.run(
        `
        INSERT OR IGNORE INTO leads
            (account_name, first_name, last_name, job_title, website, linkedin_url, status, list_name, lead_score, confidence_score, consent_basis, consent_recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'NEW'), ?, ?, ?, COALESCE(?, 'legitimate_interest'), ?)
    `,
        [
            input.accountName,
            input.firstName,
            input.lastName,
            input.jobTitle,
            input.website,
            normalizedLinkedinUrl,
            input.status ?? null,
            input.listName,
            input.leadScore ?? null,
            input.confidenceScore ?? null,
            input.consentBasis ?? null,
            input.consentRecordedAt ?? null,
        ],
    );

    const leadRow = await db.get<{ id: number }>(`SELECT id FROM leads WHERE linkedin_url = ?`, [
        normalizedLinkedinUrl,
    ]);
    const listRow = await db.get<{ id: number }>(`SELECT id FROM lead_lists WHERE name = ?`, [input.listName]);
    if (leadRow?.id && listRow?.id) {
        await db.run(`INSERT OR IGNORE INTO list_leads (list_id, lead_id) VALUES (?, ?)`, [listRow.id, leadRow.id]);
    }

    return (result.changes ?? 0) > 0;
}

export async function getLeadByLinkedinUrl(linkedinUrl: string): Promise<LeadRecord | null> {
    const db = await getDatabase();
    const normalizedUrl = normalizeLinkedInUrl(linkedinUrl);
    const lead = await db.get<LeadRecord>(`SELECT ${LEAD_SELECT_COLUMNS} FROM leads WHERE linkedin_url = ?`, [
        normalizedUrl,
    ]);
    if (!lead) return null;
    lead.status = normalizeLegacyStatus(lead.status);
    return lead;
}

export async function upsertSalesNavigatorLead(
    input: UpsertSalesNavigatorLeadInput,
): Promise<UpsertSalesNavigatorLeadResult> {
    const db = await getDatabase();
    const listName = normalizeTextValue(input.listName) || 'default';
    const linkedinUrl = normalizeLinkedInUrl(input.linkedinUrl);

    return withTransaction(db, async () => {
        await ensureLeadList(listName);
        const existing = await db.get<LeadRecord>(`SELECT ${LEAD_SELECT_COLUMNS} FROM leads WHERE linkedin_url = ?`, [
            linkedinUrl,
        ]);

        const normalizedAccountName = normalizeTextValue(input.accountName);
        const normalizedFirstName = normalizeTextValue(input.firstName);
        const normalizedLastName = normalizeTextValue(input.lastName);
        const normalizedJobTitle = normalizeTextValue(input.jobTitle);
        const normalizedWebsite = normalizeTextValue(input.website);
        const normalizedLocation = normalizeTextValue(input.location ?? '');
        const normalizedSalesnavUrl = normalizeTextValue(input.salesnavUrl ?? '');

        let leadId = 0;
        let action: UpsertSalesNavigatorLeadResult['action'] = 'unchanged';

        if (!existing) {
            const insertResult = await db.run(
                `
                INSERT INTO leads
                    (account_name, first_name, last_name, job_title, website, linkedin_url, status, list_name, about, experience, invite_prompt_variant, lead_score, confidence_score, location, salesnav_url)
                VALUES (?, ?, ?, ?, ?, ?, 'NEW', ?, NULL, NULL, NULL, ?, ?, ?, ?)
            `,
                [
                    normalizedAccountName,
                    normalizedFirstName,
                    normalizedLastName,
                    normalizedJobTitle,
                    normalizedWebsite,
                    linkedinUrl,
                    listName,
                    input.leadScore ?? null,
                    input.confidenceScore ?? null,
                    normalizedLocation || null,
                    normalizedSalesnavUrl || null,
                ],
            );
            leadId = insertResult.lastID ?? 0;
            action = 'inserted';
        } else {
            leadId = existing.id;
            const nextAccountName = mergedLeadValue(existing.account_name, normalizedAccountName);
            const nextFirstName = mergedLeadValue(existing.first_name, normalizedFirstName);
            const nextLastName = mergedLeadValue(existing.last_name, normalizedLastName);
            const nextJobTitle = mergedLeadValue(existing.job_title, normalizedJobTitle);
            const nextWebsite = normalizeTextValue(existing.website)
                ? existing.website
                : mergedLeadValue(existing.website, normalizedWebsite);
            const nextLocation = mergedLeadValue(existing.location ?? '', normalizedLocation);
            const nextSalesnavUrl = normalizeTextValue(existing.salesnav_url ?? '')
                ? (existing.salesnav_url ?? '')
                : mergedLeadValue(existing.salesnav_url ?? '', normalizedSalesnavUrl);
            const nextListName = listName;

            const changed =
                nextAccountName !== existing.account_name ||
                nextFirstName !== existing.first_name ||
                nextLastName !== existing.last_name ||
                nextJobTitle !== existing.job_title ||
                nextWebsite !== existing.website ||
                nextLocation !== (existing.location ?? '') ||
                nextSalesnavUrl !== (existing.salesnav_url ?? '') ||
                nextListName !== existing.list_name;

            if (changed) {
                await db.run(
                    `
                    UPDATE leads
                    SET account_name = ?,
                        first_name = ?,
                        last_name = ?,
                        job_title = ?,
                        website = ?,
                        list_name = ?,
                        location = ?,
                        salesnav_url = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
                    [nextAccountName, nextFirstName, nextLastName, nextJobTitle, nextWebsite, nextListName, nextLocation || null, nextSalesnavUrl || null, leadId],
                );
                action = 'updated';
            }
        }

        const linkedLead =
            leadId > 0
                ? { id: leadId }
                : await db.get<{ id: number }>(`SELECT id FROM leads WHERE linkedin_url = ?`, [linkedinUrl]);
        const listRow = await db.get<{ id: number }>(`SELECT id FROM lead_lists WHERE name = ?`, [listName]);
        if (linkedLead?.id && listRow?.id) {
            await db.run(`INSERT OR IGNORE INTO list_leads (list_id, lead_id) VALUES (?, ?)`, [
                listRow.id,
                linkedLead.id,
            ]);
        }

        return {
            leadId: linkedLead?.id ?? leadId,
            action,
        };
    });
}

export async function getExpiredInvitedLeads(_accountId: string, olderThanDays: number): Promise<LeadRecord[]> {
    const db = await getDatabase();
    return db.query<LeadRecord>(
        `SELECT ${LEAD_SELECT_COLUMNS}
         FROM leads
         WHERE status = 'INVITED'
           AND invited_at < datetime('now', '-' || ? || ' days')
         ORDER BY COALESCE(lead_score, 0) ASC, invited_at ASC
         LIMIT 50`,
        [olderThanDays],
    );
}

export async function addCompanyTarget(input: AddCompanyTargetInput): Promise<boolean> {
    const db = await getDatabase();
    await ensureLeadList(input.listName);

    const normalizedAccountName = (input.accountName ?? '').trim();
    const normalizedWebsite = (input.website ?? '').trim();
    if (!normalizedAccountName && !normalizedWebsite) {
        return false;
    }

    const result = await db.run(
        `
        INSERT OR IGNORE INTO company_targets (list_name, account_name, website, source_file, status)
        VALUES (?, ?, ?, ?, 'NEW')
    `,
        [input.listName, normalizedAccountName, normalizedWebsite, input.sourceFile ?? null],
    );
    return (result.changes ?? 0) > 0;
}

export async function countCompanyTargets(listName?: string): Promise<number> {
    const db = await getDatabase();
    const row = listName
        ? await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM company_targets WHERE list_name = ?`, [
            listName,
        ])
        : await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM company_targets`);
    return row?.total ?? 0;
}

export async function listCompanyTargets(listName: string | null, limit: number): Promise<CompanyTargetRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, limit);
    if (listName) {
        return db.query<CompanyTargetRecord>(
            `
            SELECT id, list_name, account_name, website, source_file, status, attempts, last_error, processed_at, created_at, updated_at
            FROM company_targets
            WHERE list_name = ?
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
        `,
            [listName, safeLimit],
        );
    }

    return db.query<CompanyTargetRecord>(
        `
        SELECT id, list_name, account_name, website, source_file, status, attempts, last_error, processed_at, created_at, updated_at
        FROM company_targets
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ?
    `,
        [safeLimit],
    );
}

export async function getCompanyTargetsForEnrichment(limit: number): Promise<CompanyTargetRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, limit);
    return db.query<CompanyTargetRecord>(
        `
        SELECT id, list_name, account_name, website, source_file, status, attempts, last_error, processed_at, created_at, updated_at
        FROM company_targets
        WHERE status IN ('NEW', 'ERROR')
        ORDER BY status DESC, created_at ASC
        LIMIT ?
    `,
        [safeLimit],
    );
}

export async function setCompanyTargetStatus(
    targetId: number,
    status: CompanyTargetStatus,
    lastError: string | null = null,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE company_targets
        SET status = ?,
            attempts = attempts + 1,
            last_error = ?,
            processed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [status, lastError, targetId],
    );
}

export async function countCompanyTargetsByStatuses(statuses: CompanyTargetStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const db = await getDatabase();
    const placeholders = statuses.map(() => '?').join(', ');
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM company_targets WHERE status IN (${placeholders})`,
        statuses,
    );
    return row?.total ?? 0;
}

export async function promoteNewLeadsToReadyInvite(limit: number): Promise<number> {
    const db = await getDatabase();
    const leads = await db.query<{ id: number }>(
        `SELECT id FROM leads WHERE status = 'NEW' ORDER BY created_at ASC LIMIT ?`,
        [limit],
    );
    if (leads.length === 0) return 0;

    const BATCH_SIZE = 900;
    const ids = leads.map((lead) => lead.id);
    let totalChanged = 0;

    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
        const batch = ids.slice(offset, offset + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(', ');
        const result = await db.run(
            `UPDATE leads SET status = 'READY_INVITE', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
            batch,
        );
        totalChanged += result.changes ?? 0;
    }
    return totalChanged;
}

export async function getLeadById(leadId: number): Promise<LeadRecord | null> {
    const db = await getDatabase();
    const lead = await db.get<LeadRecord>(`SELECT ${LEAD_SELECT_COLUMNS} FROM leads WHERE id = ?`, [leadId]);
    if (!lead) return null;
    lead.status = normalizeLegacyStatus(lead.status);
    return lead;
}

export async function updateLeadScrapedContext(
    leadId: number,
    about: string | null,
    experience: string | null,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE leads
        SET about = ?,
            experience = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [about, experience, leadId],
    );
}

export async function updateLeadPromptVariant(leadId: number, variant: string | null): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE leads
        SET invite_prompt_variant = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [variant, leadId],
    );
}

export interface UpdateLeadProfileDataInput {
    firstName?: string | null;
    lastName?: string | null;
    jobTitle?: string | null;
    about?: string | null;
}

export async function updateLeadProfileData(
    leadId: number,
    data: UpdateLeadProfileDataInput,
): Promise<boolean> {
    const db = await getDatabase();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.firstName !== undefined) {
        sets.push('first_name = COALESCE(NULLIF(first_name, \'\'), ?)');
        params.push(data.firstName);
    }
    if (data.lastName !== undefined) {
        sets.push('last_name = COALESCE(NULLIF(last_name, \'\'), ?)');
        params.push(data.lastName);
    }
    if (data.jobTitle !== undefined) {
        sets.push('job_title = COALESCE(NULLIF(job_title, \'\'), ?)');
        params.push(data.jobTitle);
    }
    if (data.about !== undefined) {
        sets.push('about = COALESCE(NULLIF(about, \'\'), ?)');
        params.push(data.about);
    }

    if (sets.length === 0) return false;

    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(leadId);

    const result = await db.run(
        `UPDATE leads SET ${sets.join(', ')} WHERE id = ?`,
        params,
    );
    return (result.changes ?? 0) > 0;
}

export async function adjustLeadScore(leadId: number, delta: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `UPDATE leads
         SET lead_score = MAX(0, MIN(100, COALESCE(lead_score, 50) + ?)),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [delta, leadId],
    );
}

export async function updateLeadScores(
    leadId: number,
    leadScore: number | null,
    confidenceScore: number | null,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE leads
        SET lead_score = ?,
            confidence_score = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [leadScore, confidenceScore, leadId],
    );
}

export interface UpsertLeadEnrichmentDataInput {
    leadId: number;
    companyJson: string | null;
    phonesJson: string | null;
    socialsJson: string | null;
    seniority: string | null;
    department: string | null;
    dataPoints: number;
    confidence: number;
    sourcesJson: string | null;
}

export async function upsertLeadEnrichmentData(input: UpsertLeadEnrichmentDataInput): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO lead_enrichment_data
            (lead_id, company_json, phones_json, socials_json, seniority, department, data_points, confidence, sources_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lead_id) DO UPDATE SET
            company_json = COALESCE(excluded.company_json, company_json),
            phones_json  = COALESCE(excluded.phones_json, phones_json),
            socials_json = COALESCE(excluded.socials_json, socials_json),
            seniority    = COALESCE(excluded.seniority, seniority),
            department   = COALESCE(excluded.department, department),
            data_points  = excluded.data_points,
            confidence   = excluded.confidence,
            sources_json = excluded.sources_json,
            updated_at   = CURRENT_TIMESTAMP
    `,
        [
            input.leadId,
            input.companyJson,
            input.phonesJson,
            input.socialsJson,
            input.seniority,
            input.department,
            input.dataPoints,
            input.confidence,
            input.sourcesJson,
        ],
    );
}

export type LeadTimingStrategy = 'baseline' | 'optimizer';
export type LeadTimingAction = 'invite' | 'message';

export interface LeadTimingAttributionInput {
    strategy: LeadTimingStrategy;
    segment?: string;
    score?: number;
    slotHour?: number | null;
    slotDow?: number | null;
    delaySec?: number;
    model?: string;
}

function clampHour(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.floor(value);
    if (rounded < 0 || rounded > 23) return null;
    return rounded;
}

function clampDow(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.floor(value);
    if (rounded < 0 || rounded > 6) return null;
    return rounded;
}

function clampScore(value: number | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(0, Math.min(1, value));
}

export async function recordLeadTimingAttribution(
    leadId: number,
    action: LeadTimingAction,
    input: LeadTimingAttributionInput,
): Promise<void> {
    const db = await getDatabase();
    const strategy: LeadTimingStrategy = input.strategy === 'optimizer' ? 'optimizer' : 'baseline';
    const segment = (input.segment ?? 'unknown').trim().toLowerCase() || 'unknown';
    const score = clampScore(input.score);
    const slotHour = clampHour(input.slotHour);
    const slotDow = clampDow(input.slotDow);
    const delaySec =
        typeof input.delaySec === 'number' && Number.isFinite(input.delaySec)
            ? Math.max(0, Math.floor(input.delaySec))
            : 0;
    const model = normalizeTextValue(input.model ?? '') || 'timing_optimizer_v2';

    if (action === 'invite') {
        await db.run(
            `
            UPDATE leads
            SET invite_timing_strategy = ?,
                invite_timing_segment = ?,
                invite_timing_score = ?,
                invite_timing_slot_hour = ?,
                invite_timing_slot_dow = ?,
                invite_timing_delay_sec = ?,
                invite_timing_model = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [strategy, segment, score, slotHour, slotDow, delaySec, model, leadId],
        );
        return;
    }

    await db.run(
        `
        UPDATE leads
        SET message_timing_strategy = ?,
            message_timing_segment = ?,
            message_timing_score = ?,
            message_timing_slot_hour = ?,
            message_timing_slot_dow = ?,
            message_timing_delay_sec = ?,
            message_timing_model = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [strategy, segment, score, slotHour, slotDow, delaySec, model, leadId],
    );
}

export async function getLeadsWithSalesNavigatorUrls(limit: number): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, limit);
    const leads = await db.query<LeadRecord>(
        `
        SELECT ${LEAD_SELECT_COLUMNS}
        FROM leads
        WHERE linkedin_url LIKE '%linkedin.com/sales/%'
          AND status IN ('NEW', 'READY_INVITE', 'INVITED', 'ACCEPTED', 'READY_MESSAGE', 'BLOCKED')
        ORDER BY updated_at DESC, created_at ASC
        LIMIT ?
    `,
        [safeLimit],
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function updateLeadLinkedinUrl(
    leadId: number,
    nextLinkedinUrl: string,
): Promise<UpdateLeadLinkedinUrlResult> {
    const db = await getDatabase();
    const normalizedUrl = normalizeLinkedInUrl(nextLinkedinUrl);

    try {
        const result = await db.run(
            `
            UPDATE leads
            SET linkedin_url = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [normalizedUrl, leadId],
        );
        return {
            updated: (result.changes ?? 0) > 0,
            conflictLeadId: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/UNIQUE constraint failed:\s*leads\.linkedin_url/i.test(message)) {
            throw error;
        }
        const conflict = await db.get<{ id: number }>(`SELECT id FROM leads WHERE linkedin_url = ? LIMIT 1`, [
            normalizedUrl,
        ]);
        return {
            updated: false,
            conflictLeadId: conflict?.id ?? null,
        };
    }
}

export async function getLeadsByStatus(status: LeadStatus, limit: number): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const normalized = normalizeLegacyStatus(status);
    const leads = await db.query<LeadRecord>(
        `SELECT ${LEAD_SELECT_COLUMNS} FROM leads WHERE status = ? ORDER BY created_at ASC LIMIT ?`,
        [normalized, limit],
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export interface ReviewQueueItem {
    leadId: number;
    status: LeadStatus;
    listName: string;
    accountName: string;
    linkedinUrl: string;
    updatedAt: string;
    reviewReason: string | null;
    reviewEventAt: string | null;
    evidencePath: string | null;
    metadata: Record<string, unknown> | null;
}

function parseReviewMetadata(raw: string | null): Record<string, unknown> | null {
    if (!raw || !raw.trim()) return null;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

export async function listReviewQueue(limit: number = 50): Promise<ReviewQueueItem[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = await db.query<{
        lead_id: number;
        status: string;
        list_name: string;
        account_name: string;
        linkedin_url: string;
        updated_at: string;
        review_reason: string | null;
        review_event_at: string | null;
        review_metadata_json: string | null;
    }>(
        `
        SELECT
            l.id AS lead_id,
            l.status,
            l.list_name,
            l.account_name,
            l.linkedin_url,
            l.updated_at,
            e.reason AS review_reason,
            e.created_at AS review_event_at,
            e.metadata_json AS review_metadata_json
        FROM leads l
        LEFT JOIN lead_events e
            ON e.id = (
                SELECT le.id
                FROM lead_events le
                WHERE le.lead_id = l.id
                  AND le.to_status = 'REVIEW_REQUIRED'
                ORDER BY le.created_at DESC, le.id DESC
                LIMIT 1
            )
        WHERE l.status = 'REVIEW_REQUIRED'
        ORDER BY COALESCE(e.created_at, l.updated_at) DESC, l.updated_at DESC
        LIMIT ?
    `,
        [safeLimit],
    );

    return rows.map((row) => {
        const metadata = parseReviewMetadata(row.review_metadata_json ?? null);
        const evidencePath = typeof metadata?.evidencePath === 'string' ? metadata.evidencePath : null;
        return {
            leadId: row.lead_id,
            status: normalizeLegacyStatus((row.status ?? 'REVIEW_REQUIRED') as LeadStatus),
            listName: row.list_name,
            accountName: row.account_name,
            linkedinUrl: row.linkedin_url,
            updatedAt: row.updated_at,
            reviewReason: row.review_reason,
            reviewEventAt: row.review_event_at,
            evidencePath,
            metadata,
        };
    });
}

export async function getLeadsForFollowUp(
    delayDays: number,
    maxFollowUp: number,
    limit: number,
): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const leads = await db.query<LeadRecord>(
        `SELECT ${LEAD_SELECT_COLUMNS}
         FROM leads
         WHERE status = 'MESSAGED'
           AND follow_up_count < ?
           AND messaged_at IS NOT NULL
           AND messaged_at <= DATETIME('now', '-' || ? || ' days')
           AND (follow_up_sent_at IS NULL
                OR follow_up_sent_at <= DATETIME('now', '-' || ? || ' days'))
           AND NOT EXISTS (
               SELECT 1 FROM lead_intents li
               WHERE li.lead_id = leads.id
                 AND li.analyzed_at > COALESCE(leads.follow_up_sent_at, leads.messaged_at)
           )
         ORDER BY messaged_at ASC
         LIMIT ?`,
        [maxFollowUp, delayDays, delayDays, limit],
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function recordFollowUpSent(leadId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `UPDATE leads
         SET follow_up_count   = follow_up_count + 1,
             follow_up_sent_at = DATETIME('now'),
             updated_at        = DATETIME('now')
         WHERE id = ?`,
        [leadId],
    );
}

export async function getLeadsByStatusForSiteCheck(
    status: LeadStatus,
    limit: number,
    staleDays: number,
): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const normalized = normalizeLegacyStatus(status);
    const safeLimit = Math.max(1, limit);
    const safeStaleDays = Math.max(0, staleDays);
    const leads = await db.query<LeadRecord>(
        `
        SELECT ${LEAD_SELECT_COLUMNS}
        FROM leads
        WHERE status = ?
          AND (
            last_site_check_at IS NULL
            OR last_site_check_at <= DATETIME('now', '-' || ? || ' days')
          )
        ORDER BY
            CASE WHEN last_site_check_at IS NULL THEN 0 ELSE 1 END ASC,
            last_site_check_at ASC,
            created_at ASC
        LIMIT ?
    `,
        [normalized, safeStaleDays, safeLimit],
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function getLeadsByStatusForList(
    status: LeadStatus,
    listName: string,
    limit: number,
    minScore?: number,
): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const normalized = normalizeLegacyStatus(status);
    const params: unknown[] = [normalized, listName];
    let scoreClause = '';
    if (minScore !== null && minScore !== undefined && minScore > 0) {
        scoreClause = 'AND lead_score IS NOT NULL AND lead_score >= ?';
        params.push(minScore);
    }
    params.push(limit);
    // H13: Per INVITED, filtra lead invitati da almeno 2 giorni.
    // Controllare un lead invitato 1 ora fa è inutile (LinkedIn impiega 1-7 giorni per l'accettazione)
    // e spreca budget visite profilo (ogni check = 1 profile view su LinkedIn).
    const invitedAgeClause = normalized === 'INVITED'
        ? "AND invited_at IS NOT NULL AND invited_at <= DATETIME('now', '-2 days')"
        : '';
    const leads = await db.query<LeadRecord>(
        `
        SELECT ${LEAD_SELECT_COLUMNS}
        FROM leads
        WHERE status = ?
          AND list_name = ?
          ${scoreClause}
          ${invitedAgeClause}
          AND NOT EXISTS (
              SELECT 1
              FROM lead_campaign_state lcs
              JOIN campaigns c ON lcs.campaign_id = c.id
              WHERE lcs.lead_id = leads.id
                AND lcs.status IN ('ENROLLED', 'PENDING')
                AND c.active = 1
          )
        ORDER BY
            COALESCE(lead_score, -1) DESC,
            created_at ASC
        LIMIT ?
    `,
        params,
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function touchLeadSiteCheckAt(leadId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE leads
        SET last_site_check_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [leadId],
    );
}

export async function countLeadsByStatuses(statuses: LeadStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const db = await getDatabase();
    const normalized = statuses.map((status) => normalizeLegacyStatus(status));
    const placeholders = normalized.map(() => '?').join(', ');
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE status IN (${placeholders})`,
        normalized,
    );
    return row?.total ?? 0;
}

export async function getLeadStatusCountsForLists(listNames: string[]): Promise<ListLeadStatusCount[]> {
    if (listNames.length === 0) {
        return [];
    }

    const db = await getDatabase();
    const placeholders = listNames.map(() => '?').join(', ');
    return db.query<ListLeadStatusCount>(
        `
        SELECT list_name, status, COUNT(*) as total
        FROM leads
        WHERE list_name IN (${placeholders})
        GROUP BY list_name, status
    `,
        listNames,
    );
}

export async function setLeadStatus(
    leadId: number,
    status: LeadStatus,
    errorMessage?: string,
    blockedReason?: string,
): Promise<void> {
    const db = await getDatabase();
    const normalized = normalizeLegacyStatus(status);
    const timestampColumn =
        normalized === 'INVITED'
            ? 'invited_at'
            : normalized === 'ACCEPTED'
                ? 'accepted_at'
                : normalized === 'MESSAGED'
                    ? 'messaged_at'
                    : null;

    if (timestampColumn) {
        await db.run(
            `
            UPDATE leads
            SET status = ?, ${timestampColumn} = CURRENT_TIMESTAMP, last_error = ?, blocked_reason = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [normalized, errorMessage ?? null, blockedReason ?? null, leadId],
        );
        return;
    }

    await db.run(
        `
        UPDATE leads
        SET status = ?, last_error = ?, blocked_reason = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [normalized, errorMessage ?? null, blockedReason ?? null, leadId],
    );
}

export async function appendLeadEvent(
    leadId: number,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
    reason: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    const db = await getDatabase();
    // M23: Calcola duration_seconds — quanto tempo il lead è stato nello stato precedente.
    // Legge il timestamp dell'ultimo evento per questo lead e calcola la differenza.
    let durationSeconds: number | null = null;
    try {
        const lastEvent = await db.get<{ created_at: string }>(
            `SELECT created_at FROM lead_events WHERE lead_id = ? ORDER BY id DESC LIMIT 1`,
            [leadId],
        );
        if (lastEvent?.created_at) {
            const elapsed = Date.now() - new Date(lastEvent.created_at).getTime();
            if (Number.isFinite(elapsed) && elapsed > 0) {
                durationSeconds = Math.round(elapsed / 1000);
            }
        }
    } catch (durErr) {
        // A04: calcolo durata fallito — non bloccante ma utile per debug
        void logWarn('leads_core.a04.duration_calc_failed', {
            error: durErr instanceof Error ? durErr.message : String(durErr),
        });
    }

    const enrichedMetadata = durationSeconds !== null
        ? { ...metadata, duration_seconds: durationSeconds }
        : metadata;

    await db.run(
        `
        INSERT INTO lead_events (lead_id, from_status, to_status, reason, metadata_json)
        VALUES (?, ?, ?, ?, ?)
    `,
        [leadId, normalizeLegacyStatus(fromStatus), normalizeLegacyStatus(toStatus), reason, JSON.stringify(enrichedMetadata)],
    );
}

export interface SearchLeadsOptions {
    query?: string;
    status?: LeadStatus;
    listName?: string;
    page?: number;
    pageSize?: number;
}

export interface SearchLeadsResult {
    leads: LeadRecord[];
    total: number;
    page: number;
    pageSize: number;
}

export async function searchLeads(opts: SearchLeadsOptions): Promise<SearchLeadsResult> {
    const db = await getDatabase();
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.query) {
        const like = `%${opts.query}%`;
        conditions.push(
            `(first_name LIKE ? OR last_name LIKE ? OR account_name LIKE ? OR linkedin_url LIKE ? OR job_title LIKE ? OR email LIKE ?)`,
        );
        params.push(like, like, like, like, like, like);
    }
    if (opts.status) {
        conditions.push(`status = ?`);
        params.push(opts.status);
    }
    if (opts.listName) {
        conditions.push(`list_name = ?`);
        params.push(opts.listName);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads ${whereClause}`,
        params,
    );
    const total = countRow?.total ?? 0;

    const leads = await db.query<LeadRecord>(
        `SELECT ${LEAD_SELECT_COLUMNS} FROM leads ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
    );

    for (const lead of leads) {
        lead.status = normalizeLegacyStatus(lead.status);
    }

    return { leads, total, page, pageSize };
}

export async function getLeadTimeline(leadId: number): Promise<Array<{
    from_status: string;
    to_status: string;
    reason: string;
    metadata_json: string;
    created_at: string;
}>> {
    const db = await getDatabase();
    return db.query(
        `SELECT from_status, to_status, reason, metadata_json, created_at
         FROM lead_events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50`,
        [leadId],
    );
}

/**
 * Ritorna lead che necessitano di enrichment:
 * - Status NEW o READY_INVITE
 * - Mai arricchiti (nessun record in lead_enrichment_data)
 *   OPPURE arricchiti ma senza business email (solo email personale)
 * Usato dallo scheduler per enqueue automatico di job ENRICHMENT.
 */
// ─── Multi-Account Deconfliction (1.4) ───────────────────────────────────────

/**
 * Verifica se un altro account (diverso da excludeAccountId) ha già
 * targetizzato lo stesso lead (per linkedin_url) negli ultimi lookbackDays.
 * Controlla sia job INVITE enqueued che lead già INVITED da altro account.
 * Previene che 2 account invitino la stessa persona — LinkedIn rileva coordinamento.
 */
export async function hasOtherAccountTargeted(
    linkedinUrl: string,
    excludeAccountId: string,
    lookbackDays: number = 30,
): Promise<boolean> {
    const db = await getDatabase();
    const normalizedUrl = normalizeLinkedInUrl(linkedinUrl);
    const safeLookbackDays = Math.max(1, Math.floor(lookbackDays));

    // Approccio efficiente senza JSON_EXTRACT: cerco il lead per URL, poi
    // verifico se ha job INVITE da un account diverso. Usa indice su linkedin_url.
    const row = await db.get<{ cnt: number }>(`
        SELECT COUNT(*) as cnt
        FROM leads l
        WHERE l.linkedin_url = ?
          AND l.invited_at IS NOT NULL
          AND l.invited_at >= DATETIME('now', '-' || ? || ' days')
          AND EXISTS (
            SELECT 1 FROM jobs j
            WHERE j.type = 'INVITE'
              AND j.account_id != ?
              AND j.status IN ('QUEUED', 'RUNNING', 'SUCCEEDED')
              AND j.created_at >= DATETIME('now', '-' || ? || ' days')
              AND j.payload_json LIKE '%"leadId":' || l.id || '%'
          )
    `, [normalizedUrl, safeLookbackDays, excludeAccountId, safeLookbackDays]);

    return (row?.cnt ?? 0) > 0;
}

export async function getLeadsNeedingEnrichment(limit: number): Promise<Array<{ id: number }>> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return db.query<{ id: number }>(
        `
        SELECT l.id
        FROM leads l
        LEFT JOIN lead_enrichment_data e ON e.lead_id = l.id
        WHERE l.status IN ('NEW', 'READY_INVITE', 'ACCEPTED')
          AND (
            e.lead_id IS NULL
            OR (l.business_email IS NULL AND l.account_name IS NOT NULL AND TRIM(l.account_name) != '')
          )
        ORDER BY
          CASE WHEN e.lead_id IS NULL THEN 0 ELSE 1 END,
          l.created_at DESC
        LIMIT ?
        `,
        [safeLimit],
    );
}

/**
 * Ritorna un sommario enrichment per AI decision context.
 * Single indexed query su PK lead_enrichment_data.lead_id (~<1ms).
 */
export async function getLeadEnrichmentSummary(leadId: number): Promise<{
    seniority: string | null;
    department: string | null;
    industry: string | null;
} | null> {
    const db = await getDatabase();
    const row = await db.get<{ seniority: string | null; department: string | null; company_json: string | null }>(
        `SELECT seniority, department, company_json FROM lead_enrichment_data WHERE lead_id = ?`,
        [leadId],
    );
    if (!row) return null;
    let industry: string | null = null;
    if (row.company_json) {
        try {
            const company = JSON.parse(row.company_json) as Record<string, unknown>;
            industry = typeof company.industry === 'string' ? company.industry : null;
        } catch {
            // malformed JSON — skip
        }
    }
    return { seniority: row.seniority, department: row.department, industry };
}
