import { Database } from 'sqlite';
import { getDatabase } from '../db';
import {
    JobRecord,
    JobStatus,
    JobType,
    LeadRecord,
    LeadStatus,
    OutboxEventRecord,
    RiskInputs,
} from '../types/domain';
import { normalizeLinkedInUrl } from '../linkedinUrl';

function parsePayload<T>(raw: string): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return {} as T;
    }
}

async function withTransaction<T>(database: Database, callback: () => Promise<T>): Promise<T> {
    await database.exec('BEGIN IMMEDIATE');
    try {
        const result = await callback();
        await database.exec('COMMIT');
        return result;
    } catch (error) {
        await database.exec('ROLLBACK');
        throw error;
    }
}

function normalizeLegacyStatus(status: LeadStatus): LeadStatus {
    if (status === 'PENDING') {
        return 'READY_INVITE';
    }
    return status;
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
        ? await db.all<LeadListRow[]>(
            `
            SELECT name, source, is_active, priority, daily_invite_cap, daily_message_cap, created_at
            FROM lead_lists
            WHERE is_active = 1
            ORDER BY priority ASC, created_at ASC, name ASC
        `
        )
        : await db.all<LeadListRow[]>(
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
    return db.all<SalesNavListSummary[]>(
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

export interface AddLeadInput {
    accountName: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    website: string;
    linkedinUrl: string;
    listName: string;
}

export interface UpsertSalesNavigatorLeadInput {
    accountName: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    website: string;
    linkedinUrl: string;
    listName: string;
}

export interface UpsertSalesNavigatorLeadResult {
    leadId: number;
    action: 'inserted' | 'updated' | 'unchanged';
}

export interface SalesNavListRecord {
    id: number;
    name: string;
    url: string;
    last_synced_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SalesNavListSummary extends SalesNavListRecord {
    leads_count: number;
}

interface LeadListRow {
    name: string;
    source: string;
    is_active: number;
    priority: number;
    daily_invite_cap: number | null;
    daily_message_cap: number | null;
    created_at: string;
}

export interface LeadListCampaignConfig {
    name: string;
    source: string;
    isActive: boolean;
    priority: number;
    dailyInviteCap: number | null;
    dailyMessageCap: number | null;
    createdAt: string;
}

export interface UpdateLeadListCampaignInput {
    isActive?: boolean;
    priority?: number;
    dailyInviteCap?: number | null;
    dailyMessageCap?: number | null;
}

export interface AddCompanyTargetInput {
    listName: string;
    accountName: string;
    website: string;
    sourceFile?: string | null;
}

export type CompanyTargetStatus = 'NEW' | 'ENRICHED' | 'NO_MATCH' | 'ERROR';

export interface CompanyTargetRecord {
    id: number;
    list_name: string;
    account_name: string;
    website: string;
    source_file: string | null;
    status: CompanyTargetStatus;
    attempts: number;
    last_error: string | null;
    processed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface DailyStatsSnapshot {
    date: string;
    invitesSent: number;
    messagesSent: number;
    challengesCount: number;
    selectorFailures: number;
    runErrors: number;
}

export interface JobStatusCounts {
    QUEUED: number;
    RUNNING: number;
    SUCCEEDED: number;
    FAILED: number;
    DEAD_LETTER: number;
    PAUSED: number;
}

export interface AutomationPauseState {
    paused: boolean;
    pausedUntil: string | null;
    reason: string | null;
    remainingSeconds: number | null;
}

export interface PrivacyCleanupStats {
    runLogs: number;
    jobAttempts: number;
    leadEvents: number;
    messageHistory: number;
    deliveredOutboxEvents: number;
    resolvedIncidents: number;
}

export interface ListLeadStatusCount {
    list_name: string;
    status: LeadStatus;
    total: number;
}

export interface RuntimeLockRecord {
    lock_key: string;
    owner_id: string;
    acquired_at: string;
    heartbeat_at: string;
    expires_at: string;
    metadata_json: string;
    updated_at: string;
}

export interface AcquireRuntimeLockResult {
    acquired: boolean;
    lock: RuntimeLockRecord | null;
}

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

export async function addLead(input: AddLeadInput): Promise<boolean> {
    const db = await getDatabase();
    await ensureLeadList(input.listName);

    const result = await db.run(
        `
        INSERT OR IGNORE INTO leads
            (account_name, first_name, last_name, job_title, website, linkedin_url, status, list_name)
        VALUES (?, ?, ?, ?, ?, ?, 'NEW', ?)
    `,
        [
            input.accountName,
            input.firstName,
            input.lastName,
            input.jobTitle,
            input.website,
            input.linkedinUrl,
            input.listName,
        ]
    );

    // Mantiene la relazione lista<->lead anche quando il lead esiste già.
    const leadRow = await db.get<{ id: number }>(`SELECT id FROM leads WHERE linkedin_url = ?`, [input.linkedinUrl]);
    const listRow = await db.get<{ id: number }>(`SELECT id FROM lead_lists WHERE name = ?`, [input.listName]);
    if (leadRow?.id && listRow?.id) {
        await db.run(`INSERT OR IGNORE INTO list_leads (list_id, lead_id) VALUES (?, ?)`, [listRow.id, leadRow.id]);
    }

    return (result.changes ?? 0) > 0;
}

function normalizeTextValue(value: string): string {
    return (value ?? '').trim();
}

function mergedLeadValue(current: string, incoming: string): string {
    const normalizedIncoming = normalizeTextValue(incoming);
    if (!normalizedIncoming) {
        return current;
    }
    if (normalizeTextValue(current) === normalizedIncoming) {
        return current;
    }
    return normalizedIncoming;
}

export async function getLeadByLinkedinUrl(linkedinUrl: string): Promise<LeadRecord | null> {
    const db = await getDatabase();
    const normalizedUrl = normalizeLinkedInUrl(linkedinUrl);
    const lead = await db.get<LeadRecord>(`SELECT * FROM leads WHERE linkedin_url = ?`, [normalizedUrl]);
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
        const existing = await db.get<LeadRecord>(`SELECT * FROM leads WHERE linkedin_url = ?`, [linkedinUrl]);

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
                    (account_name, first_name, last_name, job_title, website, linkedin_url, status, list_name, about, experience, invite_prompt_variant)
                VALUES (?, ?, ?, ?, ?, ?, 'NEW', ?, NULL, NULL, NULL)
            `,
                [
                    normalizedAccountName,
                    normalizedFirstName,
                    normalizedLastName,
                    normalizedJobTitle,
                    normalizedWebsite,
                    linkedinUrl,
                    listName,
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
        return db.all<CompanyTargetRecord[]>(
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

    return db.all<CompanyTargetRecord[]>(
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
    return db.all<CompanyTargetRecord[]>(
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
    const leads = await db.all<{ id: number }[]>(
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
    const lead = await db.get<LeadRecord>(`SELECT * FROM leads WHERE id = ?`, [leadId]);
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

export async function getLeadsWithSalesNavigatorUrls(limit: number): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, limit);
    const leads = await db.all<LeadRecord[]>(
        `
        SELECT *
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

export interface UpdateLeadLinkedinUrlResult {
    updated: boolean;
    conflictLeadId: number | null;
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
    const leads = await db.all<LeadRecord[]>(
        `SELECT * FROM leads WHERE status = ? ORDER BY created_at ASC LIMIT ?`,
        [normalized, limit]
    );
    return leads.map((lead) => ({ ...lead, status: normalizeLegacyStatus(lead.status) }));
}

export async function getLeadsByStatusForSiteCheck(status: LeadStatus, limit: number, staleDays: number): Promise<LeadRecord[]> {
    const db = await getDatabase();
    const normalized = normalizeLegacyStatus(status);
    const safeLimit = Math.max(1, limit);
    const safeStaleDays = Math.max(0, staleDays);
    const leads = await db.all<LeadRecord[]>(
        `
        SELECT *
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
    const leads = await db.all<LeadRecord[]>(
        `
        SELECT *
        FROM leads
        WHERE status = ?
          AND list_name = ?
        ORDER BY created_at ASC
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
    return db.all<ListLeadStatusCount[]>(
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

export async function getDailyStat(dateString: string, field: 'invites_sent' | 'messages_sent' | 'challenges_count' | 'selector_failures' | 'run_errors'): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<Record<string, number>>(
        `SELECT ${field} FROM daily_stats WHERE date = ?`,
        [dateString]
    );
    return row?.[field] ?? 0;
}

export async function getDailyStatsSnapshot(dateString: string): Promise<DailyStatsSnapshot> {
    const db = await getDatabase();
    const row = await db.get<{
        invites_sent: number;
        messages_sent: number;
        challenges_count: number;
        selector_failures: number;
        run_errors: number;
    }>(
        `SELECT invites_sent, messages_sent, challenges_count, selector_failures, run_errors FROM daily_stats WHERE date = ?`,
        [dateString]
    );

    return {
        date: dateString,
        invitesSent: row?.invites_sent ?? 0,
        messagesSent: row?.messages_sent ?? 0,
        challengesCount: row?.challenges_count ?? 0,
        selectorFailures: row?.selector_failures ?? 0,
        runErrors: row?.run_errors ?? 0,
    };
}

export async function getListDailyStat(
    dateString: string,
    listName: string,
    field: 'invites_sent' | 'messages_sent'
): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<Record<string, number>>(
        `SELECT ${field} FROM list_daily_stats WHERE date = ? AND list_name = ?`,
        [dateString, listName]
    );
    return row?.[field] ?? 0;
}

export async function incrementDailyStat(
    dateString: string,
    field: 'invites_sent' | 'messages_sent' | 'acceptances' | 'challenges_count' | 'selector_failures' | 'run_errors',
    amount: number = 1
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO daily_stats (date, ${field}) VALUES (?, ?)
        ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + ?
    `,
        [dateString, amount, amount]
    );
}

export async function incrementListDailyStat(
    dateString: string,
    listName: string,
    field: 'invites_sent' | 'messages_sent',
    amount: number = 1
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO list_daily_stats (date, list_name, ${field}) VALUES (?, ?, ?)
        ON CONFLICT(date, list_name) DO UPDATE SET ${field} = ${field} + ?
    `,
        [dateString, listName, amount, amount]
    );
}

export async function countWeeklyInvites(weekStartDate: string): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(invites_sent), 0) as total FROM daily_stats WHERE date >= ?`,
        [weekStartDate]
    );
    return row?.total ?? 0;
}

export async function enqueueJob(
    type: JobType,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    priority: number,
    maxAttempts: number,
    initialDelaySeconds: number = 0,
    accountId: string = 'default'
): Promise<boolean> {
    const db = await getDatabase();
    const safeDelay = Math.max(0, Math.floor(initialDelaySeconds));
    const normalizedAccountId = accountId.trim() || 'default';
    const result = await db.run(
        `
        INSERT OR IGNORE INTO jobs (type, status, account_id, payload_json, idempotency_key, priority, max_attempts, next_run_at)
        VALUES (?, 'QUEUED', ?, ?, ?, ?, ?, DATETIME('now', '+' || ? || ' seconds'))
    `,
        [type, normalizedAccountId, JSON.stringify(payload), idempotencyKey, priority, maxAttempts, safeDelay]
    );
    return (result.changes ?? 0) > 0;
}

export async function lockNextQueuedJob(
    allowedTypes: JobType[],
    accountId?: string,
    includeLegacyDefaultQueue: boolean = false
): Promise<JobRecord | null> {
    if (allowedTypes.length === 0) {
        return null;
    }
    const db = await getDatabase();
    return withTransaction(db, async () => {
        const placeholders = allowedTypes.map(() => '?').join(', ');
        const whereClauses = [
            `status = 'QUEUED'`,
            `next_run_at <= CURRENT_TIMESTAMP`,
            `type IN (${placeholders})`,
        ];
        const params: unknown[] = [...allowedTypes];

        const normalizedAccountId = accountId?.trim();
        if (normalizedAccountId) {
            if (includeLegacyDefaultQueue && normalizedAccountId !== 'default') {
                whereClauses.push(`account_id IN (?, 'default')`);
                params.push(normalizedAccountId);
            } else {
                whereClauses.push(`account_id = ?`);
                params.push(normalizedAccountId);
            }
        }

        const job = await db.get<JobRecord>(
            `
            SELECT * FROM jobs
            WHERE ${whereClauses.join('\n              AND ')}
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
        `,
            params
        );

        if (!job) return null;

        const updateResult = await db.run(
            `
            UPDATE jobs
            SET status = 'RUNNING', locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'QUEUED'
        `,
            [job.id]
        );
        if ((updateResult.changes ?? 0) === 0) {
            return null;
        }

        return {
            ...job,
            status: 'RUNNING',
            payload_json: job.payload_json,
        };
    });
}

export async function markJobSucceeded(jobId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE jobs
        SET status = 'SUCCEEDED', locked_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [jobId]
    );
}

export async function markJobRetryOrDeadLetter(
    jobId: number,
    attempts: number,
    maxAttempts: number,
    nextRetryDelayMs: number,
    errorMessage: string
): Promise<JobStatus> {
    const db = await getDatabase();
    if (attempts >= maxAttempts) {
        await db.run(
            `
            UPDATE jobs
            SET status = 'DEAD_LETTER',
                attempts = ?,
                last_error = ?,
                locked_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [attempts, errorMessage, jobId]
        );
        return 'DEAD_LETTER';
    }

    const seconds = Math.max(1, Math.ceil(nextRetryDelayMs / 1000));
    await db.run(
        `
        UPDATE jobs
        SET status = 'QUEUED',
            attempts = ?,
            last_error = ?,
            next_run_at = DATETIME('now', '+' || ? || ' seconds'),
            locked_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [attempts, errorMessage, seconds, jobId]
    );
    return 'QUEUED';
}

export async function createJobAttempt(
    jobId: number,
    success: boolean,
    errorCode: string | null,
    errorMessage: string | null,
    evidencePath: string | null
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO job_attempts (job_id, finished_at, success, error_code, error_message, evidence_path)
        VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `,
        [jobId, success ? 1 : 0, errorCode, errorMessage, evidencePath]
    );
}

export async function createIncident(
    type: string,
    severity: 'INFO' | 'WARN' | 'CRITICAL',
    details: Record<string, unknown>
): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `
        INSERT INTO account_incidents (type, severity, status, details_json)
        VALUES (?, ?, 'OPEN', ?)
    `,
        [type, severity, JSON.stringify(details)]
    );
    return result.lastID ?? 0;
}

export async function listOpenIncidents(): Promise<Array<{ id: number; type: string; severity: string; opened_at: string }>> {
    const db = await getDatabase();
    return db.all(`SELECT id, type, severity, opened_at FROM account_incidents WHERE status = 'OPEN' ORDER BY opened_at DESC`);
}

export async function resolveIncident(incidentId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE account_incidents
        SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [incidentId]
    );
}

export async function pushOutboxEvent(topic: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT OR IGNORE INTO outbox_events (topic, payload_json, idempotency_key)
        VALUES (?, ?, ?)
    `,
        [topic, JSON.stringify(payload), idempotencyKey]
    );
}

export async function getPendingOutboxEvents(limit: number): Promise<OutboxEventRecord[]> {
    const db = await getDatabase();
    return db.all<OutboxEventRecord[]>(
        `
        SELECT * FROM outbox_events
        WHERE delivered_at IS NULL
          AND next_retry_at <= CURRENT_TIMESTAMP
        ORDER BY created_at ASC
        LIMIT ?
    `,
        [limit]
    );
}

export async function markOutboxDelivered(eventId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE outbox_events
        SET delivered_at = CURRENT_TIMESTAMP,
            last_error = NULL
        WHERE id = ?
    `,
        [eventId]
    );
}

export async function markOutboxRetry(eventId: number, attempts: number, retryDelayMs: number, errorMessage: string): Promise<void> {
    const db = await getDatabase();
    const seconds = Math.max(1, Math.ceil(retryDelayMs / 1000));
    await db.run(
        `
        UPDATE outbox_events
        SET attempts = ?,
            next_retry_at = DATETIME('now', '+' || ? || ' seconds'),
            last_error = ?
        WHERE id = ?
    `,
        [attempts, seconds, errorMessage, eventId]
    );
}

export async function markOutboxPermanentFailure(eventId: number, attempts: number, errorMessage: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE outbox_events
        SET attempts = ?,
            delivered_at = CURRENT_TIMESTAMP,
            last_error = ?
        WHERE id = ?
    `,
        [attempts, `PERMANENT_FAILURE: ${errorMessage}`, eventId]
    );
}

export async function countPendingOutboxEvents(): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM outbox_events WHERE delivered_at IS NULL`);
    return row?.total ?? 0;
}

export async function getJobStatusCounts(): Promise<JobStatusCounts> {
    const db = await getDatabase();
    const rows = await db.all<{ status: JobStatus; total: number }[]>(
        `SELECT status, COUNT(*) as total FROM jobs GROUP BY status`
    );

    const counts: JobStatusCounts = {
        QUEUED: 0,
        RUNNING: 0,
        SUCCEEDED: 0,
        FAILED: 0,
        DEAD_LETTER: 0,
        PAUSED: 0,
    };

    for (const row of rows) {
        if (row.status in counts) {
            counts[row.status] = row.total;
        }
    }

    return counts;
}

export async function getRuntimeLock(lockKey: string): Promise<RuntimeLockRecord | null> {
    const db = await getDatabase();
    const row = await db.get<RuntimeLockRecord>(`SELECT * FROM runtime_locks WHERE lock_key = ?`, [lockKey]);
    return row ?? null;
}

export async function acquireRuntimeLock(
    lockKey: string,
    ownerId: string,
    ttlSeconds: number,
    metadata: Record<string, unknown> = {}
): Promise<AcquireRuntimeLockResult> {
    const db = await getDatabase();
    const safeTtl = Math.max(1, ttlSeconds);
    const metadataJson = JSON.stringify(metadata);

    return withTransaction(db, async () => {
        const existing = await db.get<RuntimeLockRecord>(
            `SELECT * FROM runtime_locks WHERE lock_key = ?`,
            [lockKey]
        );

        if (!existing) {
            await db.run(
                `
                INSERT INTO runtime_locks (lock_key, owner_id, metadata_json, expires_at)
                VALUES (?, ?, ?, DATETIME('now', '+' || ? || ' seconds'))
            `,
                [lockKey, ownerId, metadataJson, safeTtl]
            );
            const inserted = await db.get<RuntimeLockRecord>(`SELECT * FROM runtime_locks WHERE lock_key = ?`, [lockKey]);
            return {
                acquired: true,
                lock: inserted ?? null,
            };
        }

        if (existing.owner_id === ownerId) {
            await db.run(
                `
                UPDATE runtime_locks
                SET heartbeat_at = CURRENT_TIMESTAMP,
                    expires_at = DATETIME('now', '+' || ? || ' seconds'),
                    metadata_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lock_key = ?
            `,
                [safeTtl, metadataJson, lockKey]
            );
            const renewed = await db.get<RuntimeLockRecord>(`SELECT * FROM runtime_locks WHERE lock_key = ?`, [lockKey]);
            return {
                acquired: true,
                lock: renewed ?? null,
            };
        }

        const isStaleRow = await db.get<{ stale: number }>(
            `
            SELECT CASE WHEN expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS stale
            FROM runtime_locks
            WHERE lock_key = ?
        `,
            [lockKey]
        );

        if ((isStaleRow?.stale ?? 0) === 1) {
            await db.run(
                `
                UPDATE runtime_locks
                SET owner_id = ?,
                    acquired_at = CURRENT_TIMESTAMP,
                    heartbeat_at = CURRENT_TIMESTAMP,
                    expires_at = DATETIME('now', '+' || ? || ' seconds'),
                    metadata_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lock_key = ?
            `,
                [ownerId, safeTtl, metadataJson, lockKey]
            );
            const takenOver = await db.get<RuntimeLockRecord>(`SELECT * FROM runtime_locks WHERE lock_key = ?`, [lockKey]);
            return {
                acquired: true,
                lock: takenOver ?? null,
            };
        }

        return {
            acquired: false,
            lock: existing,
        };
    });
}

export async function heartbeatRuntimeLock(lockKey: string, ownerId: string, ttlSeconds: number): Promise<boolean> {
    const db = await getDatabase();
    const safeTtl = Math.max(1, ttlSeconds);
    const result = await db.run(
        `
        UPDATE runtime_locks
        SET heartbeat_at = CURRENT_TIMESTAMP,
            expires_at = DATETIME('now', '+' || ? || ' seconds'),
            updated_at = CURRENT_TIMESTAMP
        WHERE lock_key = ?
          AND owner_id = ?
    `,
        [safeTtl, lockKey, ownerId]
    );
    return (result.changes ?? 0) > 0;
}

export async function releaseRuntimeLock(lockKey: string, ownerId: string): Promise<boolean> {
    const db = await getDatabase();
    const result = await db.run(
        `
        DELETE FROM runtime_locks
        WHERE lock_key = ?
          AND owner_id = ?
    `,
        [lockKey, ownerId]
    );
    return (result.changes ?? 0) > 0;
}

export async function setRuntimeFlag(key: string, value: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `,
        [key, value]
    );
}

export async function getRuntimeFlag(key: string): Promise<string | null> {
    const db = await getDatabase();
    const row = await db.get<{ value: string }>(`SELECT value FROM sync_state WHERE key = ?`, [key]);
    return row?.value ?? null;
}

export async function setAutomationPause(minutes: number | null, reason: string): Promise<string | null> {
    await setRuntimeFlag('automation_paused', 'true');
    await setRuntimeFlag('automation_pause_reason', reason.trim() || 'manual_pause');

    if (minutes === null) {
        await setRuntimeFlag('automation_paused_until', '');
        return null;
    }

    const safeMinutes = Math.max(1, minutes);
    const until = new Date(Date.now() + safeMinutes * 60_000).toISOString();
    await setRuntimeFlag('automation_paused_until', until);
    return until;
}

export async function clearAutomationPause(): Promise<void> {
    await setRuntimeFlag('automation_paused', 'false');
    await setRuntimeFlag('automation_paused_until', '');
    await setRuntimeFlag('automation_pause_reason', '');
}

export async function getAutomationPauseState(now: Date = new Date()): Promise<AutomationPauseState> {
    const paused = (await getRuntimeFlag('automation_paused')) === 'true';
    if (!paused) {
        return {
            paused: false,
            pausedUntil: null,
            reason: null,
            remainingSeconds: null,
        };
    }

    const reasonRaw = await getRuntimeFlag('automation_pause_reason');
    const untilRaw = await getRuntimeFlag('automation_paused_until');
    const parsedUntil = untilRaw && Number.isFinite(Date.parse(untilRaw))
        ? new Date(untilRaw).toISOString()
        : null;

    if (parsedUntil && Date.parse(parsedUntil) <= now.getTime()) {
        await clearAutomationPause();
        return {
            paused: false,
            pausedUntil: null,
            reason: null,
            remainingSeconds: null,
        };
    }

    const remainingSeconds = parsedUntil
        ? Math.max(0, Math.ceil((Date.parse(parsedUntil) - now.getTime()) / 1000))
        : null;

    return {
        paused: true,
        pausedUntil: parsedUntil,
        reason: reasonRaw && reasonRaw.trim() ? reasonRaw : null,
        remainingSeconds,
    };
}

export async function recordRunLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, payload: Record<string, unknown>): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO run_logs (level, event, payload_json)
        VALUES (?, ?, ?)
    `,
        [level, event, JSON.stringify(payload)]
    );
}

export async function getLastRunLogs(limit: number): Promise<Array<{ level: string; event: string; payload_json: string; created_at: string }>> {
    const db = await getDatabase();
    return db.all(
        `SELECT level, event, payload_json, created_at FROM run_logs ORDER BY created_at DESC LIMIT ?`,
        [limit]
    );
}

export async function cleanupPrivacyData(retentionDays: number): Promise<PrivacyCleanupStats> {
    const db = await getDatabase();
    const safeDays = Math.max(7, retentionDays);
    const daysParam = String(safeDays);

    const runLogs = await db.run(
        `DELETE FROM run_logs WHERE created_at < DATETIME('now', '-' || ? || ' days')`,
        [daysParam]
    );
    const jobAttempts = await db.run(
        `DELETE FROM job_attempts WHERE started_at < DATETIME('now', '-' || ? || ' days')`,
        [daysParam]
    );
    const leadEvents = await db.run(
        `DELETE FROM lead_events WHERE created_at < DATETIME('now', '-' || ? || ' days')`,
        [daysParam]
    );
    const messageHistory = await db.run(
        `DELETE FROM message_history WHERE sent_at < DATETIME('now', '-' || ? || ' days')`,
        [daysParam]
    );
    const deliveredOutboxEvents = await db.run(
        `DELETE FROM outbox_events
         WHERE delivered_at IS NOT NULL
           AND created_at < DATETIME('now', '-' || ? || ' days')`,
        [daysParam]
    );
    const resolvedIncidents = await db.run(
        `DELETE FROM account_incidents
         WHERE status = 'RESOLVED'
           AND resolved_at < DATETIME('now', '-' || ? || ' days')`,
        [daysParam]
    );

    return {
        runLogs: runLogs.changes ?? 0,
        jobAttempts: jobAttempts.changes ?? 0,
        leadEvents: leadEvents.changes ?? 0,
        messageHistory: messageHistory.changes ?? 0,
        deliveredOutboxEvents: deliveredOutboxEvents.changes ?? 0,
        resolvedIncidents: resolvedIncidents.changes ?? 0,
    };
}

export async function storeMessageHash(leadId: number, contentHash: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO message_history (lead_id, content_hash)
        VALUES (?, ?)
    `,
        [leadId, contentHash]
    );
}

export async function countRecentMessageHash(contentHash: string, hoursWindow: number): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(
        `
        SELECT COUNT(*) as total
        FROM message_history
        WHERE content_hash = ?
          AND sent_at >= DATETIME('now', '-' || ? || ' hours')
    `,
        [contentHash, hoursWindow]
    );
    return row?.total ?? 0;
}

export async function getRiskInputs(localDate: string, hardInviteCap: number): Promise<RiskInputs> {
    const db = await getDatabase();
    const pendingInvites = await countLeadsByStatuses(['INVITED']);
    const invitedTotalRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE invited_at IS NOT NULL`
    );
    const invitedTotal = invitedTotalRow?.total ?? 0;
    const pendingRatio = invitedTotal > 0 ? pendingInvites / invitedTotal : 0;

    const attemptsRow = await db.get<{ total: number }>(
        `
        SELECT COUNT(*) as total
        FROM job_attempts
        WHERE started_at >= DATETIME('now', '-24 hours')
    `
    );
    const failedRow = await db.get<{ total: number }>(
        `
        SELECT COUNT(*) as total
        FROM job_attempts
        WHERE started_at >= DATETIME('now', '-24 hours')
          AND success = 0
    `
    );
    const totalAttempts = attemptsRow?.total ?? 0;
    const failedAttempts = failedRow?.total ?? 0;
    const errorRate = totalAttempts > 0 ? failedAttempts / totalAttempts : 0;

    const selectorFailures = await getDailyStat(localDate, 'selector_failures');
    const denominator = Math.max(1, totalAttempts);
    const selectorFailureRate = selectorFailures / denominator;

    const challengeCount = await getDailyStat(localDate, 'challenges_count');
    const invitesSent = await getDailyStat(localDate, 'invites_sent');
    const inviteVelocityRatio = hardInviteCap > 0 ? invitesSent / hardInviteCap : 0;

    return {
        pendingRatio,
        errorRate,
        selectorFailureRate,
        challengeCount,
        inviteVelocityRatio,
    };
}

export interface JobWithPayload<T extends Record<string, unknown>> extends JobRecord {
    payload: T;
}

export function parseJobPayload<T extends Record<string, unknown>>(job: JobRecord): JobWithPayload<T> {
    return {
        ...job,
        payload: parsePayload<T>(job.payload_json),
    };
}


/**
 * Al boot, resetta i job RUNNING bloccati da troppo tempo.
 * Un job resta RUNNING se il processo viene killato durante l'esecuzione.
 */
export async function recoverStuckJobs(staleAfterMinutes: number = 30): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `UPDATE jobs
         SET status = 'QUEUED',
             locked_at = NULL,
             updated_at = CURRENT_TIMESTAMP,
             last_error = 'Recovered from RUNNING on startup'
         WHERE status = 'RUNNING'
           AND (
             locked_at IS NULL
             OR locked_at <= DATETIME('now', '-' || ? || ' minutes')
           )`,
        [Math.max(1, staleAfterMinutes)]
    );
    return result.changes ?? 0;
}
