import { getDatabase } from '../../db';
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
        createdAt: row.created_at,
    };
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
    `
    );
}

export async function listLeadCampaignConfigs(onlyActive: boolean = false): Promise<LeadListCampaignConfig[]> {
    const db = await getDatabase();
    const rows = onlyActive
        ? await db.query<LeadListRow>(
            `
            SELECT name, source, is_active, priority, daily_invite_cap, daily_message_cap, created_at
            FROM lead_lists
            WHERE is_active = 1
            ORDER BY priority ASC, created_at ASC, name ASC
        `
        )
        : await db.query<LeadListRow>(
            `
            SELECT name, source, is_active, priority, daily_invite_cap, daily_message_cap, created_at
            FROM lead_lists
            ORDER BY is_active DESC, priority ASC, created_at ASC, name ASC
        `
        );

    return rows.map(normalizeLeadListRow);
}

export async function updateLeadCampaignConfig(listName: string, patch: UpdateLeadListCampaignInput): Promise<LeadListCampaignConfig> {
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

    if (setParts.length > 0) {
        const db = await getDatabase();
        await db.run(
            `
            UPDATE lead_lists
            SET ${setParts.join(', ')}
            WHERE name = ?
        `,
            [...params, listName]
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
    configs: ControlPlaneCampaignConfigInput[]
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
            const nextInviteCap = configItem.dailyInviteCap === null ? null : Math.max(0, Math.floor(configItem.dailyInviteCap));
            const nextMessageCap = configItem.dailyMessageCap === null ? null : Math.max(0, Math.floor(configItem.dailyMessageCap));

            const existing = await db.get<LeadListRow>(
                `
                SELECT name, source, is_active, priority, daily_invite_cap, daily_message_cap, created_at
                FROM lead_lists
                WHERE name = ?
                LIMIT 1
            `,
                [listName]
            );

            if (!existing) {
                await db.run(
                    `
                    INSERT INTO lead_lists (name, source, is_active, priority, daily_invite_cap, daily_message_cap)
                    VALUES (?, 'control_plane', ?, ?, ?, ?)
                `,
                    [listName, nextIsActive, nextPriority, nextInviteCap, nextMessageCap]
                );
                result.created += 1;
                result.applied += 1;
                continue;
            }

            const changed = existing.source !== 'control_plane'
                || existing.is_active !== nextIsActive
                || existing.priority !== nextPriority
                || existing.daily_invite_cap !== nextInviteCap
                || existing.daily_message_cap !== nextMessageCap;

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
                [nextIsActive, nextPriority, nextInviteCap, nextMessageCap, listName]
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
        [normalizedName, normalizedUrl]
    );

    const row = await db.get<SalesNavListRecord>(
        `SELECT id, name, url, last_synced_at, created_at, updated_at FROM salesnav_lists WHERE name = ?`,
        [normalizedName]
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
        [listId]
    );
}

export async function linkLeadToSalesNavList(listId: number, leadId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT OR IGNORE INTO salesnav_list_items (list_id, lead_id)
        VALUES (?, ?)
    `,
        [listId, leadId]
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
        [safeLimit]
    );
}

export async function getSalesNavListByName(name: string): Promise<SalesNavListRecord | null> {
    const db = await getDatabase();
    const normalizedName = name.trim();
    if (!normalizedName) return null;
    const row = await db.get<SalesNavListRecord>(
        `SELECT id, name, url, last_synced_at, created_at, updated_at FROM salesnav_lists WHERE name = ? LIMIT 1`,
        [normalizedName]
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
            (account_name, first_name, last_name, job_title, website, linkedin_url, status, list_name, lead_score, confidence_score)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'NEW'), ?, ?, ?)
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
        ]
    );

    const leadRow = await db.get<{ id: number }>(`SELECT id FROM leads WHERE linkedin_url = ?`, [normalizedLinkedinUrl]);
    const listRow = await db.get<{ id: number }>(`SELECT id FROM lead_lists WHERE name = ?`, [input.listName]);
    if (leadRow?.id && listRow?.id) {
        await db.run(`INSERT OR IGNORE INTO list_leads (list_id, lead_id) VALUES (?, ?)`, [listRow.id, leadRow.id]);
    }

    return (result.changes ?? 0) > 0;
}

export async function getLeadByLinkedinUrl(linkedinUrl: string): Promise<LeadRecord | null> {
    const db = await getDatabase();
    const normalizedUrl = normalizeLinkedInUrl(linkedinUrl);
    const lead = await db.get<LeadRecord>(`SELECT ${LEAD_SELECT_COLUMNS} FROM leads WHERE linkedin_url = ?`, [normalizedUrl]);
    if (!lead) return null;
    lead.status = normalizeLegacyStatus(lead.status);
    return lead;
}

export async function upsertSalesNavigatorLead(input: UpsertSalesNavigatorLeadInput): Promise<UpsertSalesNavigatorLeadResult> {
    const db = await getDatabase();
    const listName = normalizeTextValue(input.listName) || 'default';
    const linkedinUrl = normalizeLinkedInUrl(input.linkedinUrl);

    return withTransaction(db, async () => {
        await ensureLeadList(listName);
        const existing = await db.get<LeadRecord>(`SELECT ${LEAD_SELECT_COLUMNS} FROM leads WHERE linkedin_url = ?`, [linkedinUrl]);

        const normalizedAccountName = normalizeTextValue(input.accountName);
        const normalizedFirstName = normalizeTextValue(input.firstName);
        const normalizedLastName = normalizeTextValue(input.lastName);
        const normalizedJobTitle = normalizeTextValue(input.jobTitle);
        const normalizedWebsite = normalizeTextValue(input.website);

        let leadId = 0;
        let action: UpsertSalesNavigatorLeadResult['action'] = 'unchanged';

        if (!existing) {
            const insertResult = await db.run(
                `
                INSERT INTO leads
                    (account_name, first_name, last_name, job_title, website, linkedin_url, status, list_name, about, experience, invite_prompt_variant, lead_score, confidence_score)
                VALUES (?, ?, ?, ?, ?, ?, 'NEW', ?, NULL, NULL, NULL, ?, ?)
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
                ]
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
            const nextListName = listName;

            const changed = nextAccountName !== existing.account_name
                || nextFirstName !== existing.first_name
                || nextLastName !== existing.last_name
                || nextJobTitle !== existing.job_title
                || nextWebsite !== existing.website
                || nextListName !== existing.list_name;

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
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
                    [
                        nextAccountName,
                        nextFirstName,
                        nextLastName,
                        nextJobTitle,
                        nextWebsite,
                        nextListName,
                        leadId,
                    ]
                );
                action = 'updated';
            }
        }

        const linkedLead = leadId > 0
            ? { id: leadId }
            : await db.get<{ id: number }>(`SELECT id FROM leads WHERE linkedin_url = ?`, [linkedinUrl]);
        const listRow = await db.get<{ id: number }>(`SELECT id FROM lead_lists WHERE name = ?`, [listName]);
        if (linkedLead?.id && listRow?.id) {
            await db.run(`INSERT OR IGNORE INTO list_leads (list_id, lead_id) VALUES (?, ?)`, [listRow.id, linkedLead.id]);
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
         ORDER BY invited_at ASC
         LIMIT 50`,
        [olderThanDays]
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
        [input.listName, normalizedAccountName, normalizedWebsite, input.sourceFile ?? null]
    );
    return (result.changes ?? 0) > 0;
}

export async function countCompanyTargets(listName?: string): Promise<number> {
    const db = await getDatabase();
    const row = listName
        ? await db.get<{ total: number }>(
            `SELECT COUNT(*) as total FROM company_targets WHERE list_name = ?`,
            [listName]
        )
        : await db.get<{ total: number }>(
            `SELECT COUNT(*) as total FROM company_targets`
        );
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
            [listName, safeLimit]
        );
    }

    return db.query<CompanyTargetRecord>(
        `
        SELECT id, list_name, account_name, website, source_file, status, attempts, last_error, processed_at, created_at, updated_at
        FROM company_targets
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ?
    `,
        [safeLimit]
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
        [safeLimit]
    );
}

export async function setCompanyTargetStatus(
    targetId: number,
    status: CompanyTargetStatus,
    lastError: string | null = null
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
        [status, lastError, targetId]
    );
}

export async function countCompanyTargetsByStatuses(statuses: CompanyTargetStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const db = await getDatabase();
    const placeholders = statuses.map(() => '?').join(', ');
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM company_targets WHERE status IN (${placeholders})`,
        statuses
    );
    return row?.total ?? 0;
}

export async function promoteNewLeadsToReadyInvite(limit: number): Promise<number> {
    const db = await getDatabase();
    const leads = await db.query<{ id: number }>(
        `SELECT id FROM leads WHERE status = 'NEW' ORDER BY created_at ASC LIMIT ?`,
        [limit]
    );
    if (leads.length === 0) return 0;

    const ids = leads.map((lead) => lead.id);
    const placeholders = ids.map(() => '?').join(', ');
    const result = await db.run(
        `UPDATE leads SET status = 'READY_INVITE', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
        ids
    );
    return result.changes ?? 0;
}

export async function getLeadById(leadId: number): Promise<LeadRecord | null> {
    const db = await getDatabase();
    const lead = await db.get<LeadRecord>(`SELECT ${LEAD_SELECT_COLUMNS} FROM leads WHERE id = ?`, [leadId]);
    if (!lead) return null;
    lead.status = normalizeLegacyStatus(lead.status);
    return lead;
}

export async function updateLeadScrapedContext(leadId: number, about: string | null, experience: string | null): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE leads
        SET about = ?,
            experience = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [about, experience, leadId]
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
        [variant, leadId]
    );
}

export async function updateLeadScores(leadId: number, leadScore: number | null, confidenceScore: number | null): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE leads
        SET lead_score = ?,
            confidence_score = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [leadScore, confidenceScore, leadId]
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
          AND status IN ('NEW', 'READY_INVITE', 'INVITED', 'ACCEPTED', 'READY_MESSAGE', 'BLOCKED', 'PENDING')
        ORDER BY updated_at DESC, created_at ASC
        LIMIT ?
    `,
        [safeLimit]
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function updateLeadLinkedinUrl(leadId: number, nextLinkedinUrl: string): Promise<UpdateLeadLinkedinUrlResult> {
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
            [normalizedUrl, leadId]
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
        const conflict = await db.get<{ id: number }>(
            `SELECT id FROM leads WHERE linkedin_url = ? LIMIT 1`,
            [normalizedUrl]
        );
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
        [normalized, limit]
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function getLeadsForFollowUp(
    delayDays: number,
    maxFollowUp: number,
    limit: number
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
         ORDER BY messaged_at ASC
         LIMIT ?`,
        [maxFollowUp, delayDays, delayDays, limit]
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
        [leadId]
    );
}

export async function getLeadsByStatusForSiteCheck(status: LeadStatus, limit: number, staleDays: number): Promise<LeadRecord[]> {
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
        [normalized, safeStaleDays, safeLimit]
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function getLeadsByStatusForList(status: LeadStatus, listName: string, limit: number): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const normalized = normalizeLegacyStatus(status);
    const leads = await db.query<LeadRecord>(
        `
        SELECT ${LEAD_SELECT_COLUMNS}
        FROM leads
        WHERE status = ?
          AND list_name = ?
        ORDER BY
            COALESCE(lead_score, -1) DESC,
            created_at ASC
        LIMIT ?
    `,
        [normalized, listName, limit]
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
        [leadId]
    );
}

export async function countLeadsByStatuses(statuses: LeadStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const db = await getDatabase();
    const normalized = statuses.map((status) => normalizeLegacyStatus(status));
    const placeholders = normalized.map(() => '?').join(', ');
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE status IN (${placeholders})`,
        normalized
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
        listNames
    );
}

export async function setLeadStatus(leadId: number, status: LeadStatus, errorMessage?: string, blockedReason?: string): Promise<void> {
    const db = await getDatabase();
    const normalized = normalizeLegacyStatus(status);
    const timestampColumn = normalized === 'INVITED' ? 'invited_at' : normalized === 'ACCEPTED' ? 'accepted_at' : normalized === 'MESSAGED' ? 'messaged_at' : null;

    if (timestampColumn) {
        await db.run(
            `
            UPDATE leads
            SET status = ?, ${timestampColumn} = CURRENT_TIMESTAMP, last_error = ?, blocked_reason = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [normalized, errorMessage ?? null, blockedReason ?? null, leadId]
        );
        return;
    }

    await db.run(
        `
        UPDATE leads
        SET status = ?, last_error = ?, blocked_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [normalized, errorMessage ?? null, blockedReason ?? null, leadId]
    );
}

export async function appendLeadEvent(
    leadId: number,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
    reason: string,
    metadata: Record<string, unknown>
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO lead_events (lead_id, from_status, to_status, reason, metadata_json)
        VALUES (?, ?, ?, ?, ?)
    `,
        [leadId, normalizeLegacyStatus(fromStatus), normalizeLegacyStatus(toStatus), reason, JSON.stringify(metadata)]
    );
}
