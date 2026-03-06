import { getDatabase } from '../../db';
import type {
    AddSalesNavSyncItemInput,
    CreateSalesNavSyncRunInput,
    SalesNavSyncItemRecord,
    SalesNavSyncRunRecord,
    SalesNavSyncRunSummary,
    UpdateSalesNavSyncRunProgressInput,
} from '../repositories.types';
import { normalizeTextValue, withTransaction } from './shared';

function clampNonNegative(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.floor(value));
}

async function getSyncRunById(runId: number): Promise<SalesNavSyncRunRecord | null> {
    const db = await getDatabase();
    const row = await db.get<SalesNavSyncRunRecord>(
        `
        SELECT
            id,
            account_id,
            target_list_name,
            search_name,
            status,
            total_searches,
            processed_searches,
            total_pages,
            processed_pages,
            total_leads_saved,
            current_search_index,
            current_page_number,
            last_error,
            started_at,
            completed_at,
            updated_at
        FROM salesnav_sync_runs
        WHERE id = ?
        LIMIT 1
    `,
        [runId],
    );
    return row ?? null;
}

async function getSyncRunItems(runId: number): Promise<SalesNavSyncItemRecord[]> {
    const db = await getDatabase();
    return db.query<SalesNavSyncItemRecord>(
        `
        SELECT
            id,
            run_id,
            search_index,
            page_number,
            leads_on_page,
            status,
            error_message,
            saved_at,
            created_at
        FROM salesnav_sync_items
        WHERE run_id = ?
        ORDER BY search_index ASC, page_number ASC, id ASC
    `,
        [runId],
    );
}

export async function createSyncRun(input: CreateSalesNavSyncRunInput): Promise<SalesNavSyncRunRecord> {
    const db = await getDatabase();
    const accountId = normalizeTextValue(input.accountId) || 'default';
    const targetListName = normalizeTextValue(input.targetListName);
    const searchName = normalizeTextValue(input.searchName ?? '') || null;
    if (!targetListName) {
        throw new Error('createSyncRun: targetListName obbligatorio');
    }

    const result = await db.run(
        `
        INSERT INTO salesnav_sync_runs (
            account_id,
            target_list_name,
            search_name,
            status,
            total_searches,
            processed_searches,
            total_pages,
            processed_pages,
            total_leads_saved,
            current_search_index,
            current_page_number,
            last_error
        ) VALUES (?, ?, ?, 'RUNNING', ?, 0, ?, 0, 0, ?, ?, NULL)
    `,
        [
            accountId,
            targetListName,
            searchName,
            clampNonNegative(input.totalSearches, 0),
            clampNonNegative(input.totalPages, 0),
            clampNonNegative(input.currentSearchIndex, 0),
            Math.max(1, clampNonNegative(input.currentPageNumber, 1)),
        ],
    );

    const run = await getSyncRunById(result.lastID ?? 0);
    if (!run) {
        throw new Error('createSyncRun: run non trovata dopo insert');
    }
    return run;
}

export async function updateSyncRunProgress(
    input: UpdateSalesNavSyncRunProgressInput,
): Promise<SalesNavSyncRunRecord> {
    const setParts: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: unknown[] = [];

    if (Object.prototype.hasOwnProperty.call(input, 'searchName')) {
        setParts.push('search_name = ?');
        params.push(normalizeTextValue(input.searchName ?? '') || null);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'totalSearches')) {
        setParts.push('total_searches = ?');
        params.push(clampNonNegative(input.totalSearches, 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'processedSearches')) {
        setParts.push('processed_searches = ?');
        params.push(clampNonNegative(input.processedSearches, 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'totalPages')) {
        setParts.push('total_pages = ?');
        params.push(clampNonNegative(input.totalPages, 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'processedPages')) {
        setParts.push('processed_pages = ?');
        params.push(clampNonNegative(input.processedPages, 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'totalLeadsSaved')) {
        setParts.push('total_leads_saved = ?');
        params.push(clampNonNegative(input.totalLeadsSaved, 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'currentSearchIndex')) {
        setParts.push('current_search_index = ?');
        params.push(clampNonNegative(input.currentSearchIndex, 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'currentPageNumber')) {
        setParts.push('current_page_number = ?');
        params.push(Math.max(1, clampNonNegative(input.currentPageNumber, 1)));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'lastError')) {
        setParts.push('last_error = ?');
        params.push(normalizeTextValue(input.lastError ?? '') || null);
    }

    const db = await getDatabase();
    await db.run(
        `
        UPDATE salesnav_sync_runs
        SET ${setParts.join(', ')}
        WHERE id = ?
    `,
        [...params, input.runId],
    );

    const run = await getSyncRunById(input.runId);
    if (!run) {
        throw new Error(`updateSyncRunProgress: run ${input.runId} non trovata`);
    }
    return run;
}

export async function completeSyncRun(
    runId: number,
    finalProgress: Omit<UpdateSalesNavSyncRunProgressInput, 'runId'> = {},
): Promise<SalesNavSyncRunRecord> {
    const db = await getDatabase();
    return withTransaction(db, async () => {
        if (Object.keys(finalProgress).length > 0) {
            await updateSyncRunProgress({ runId, ...finalProgress, lastError: null });
        }
        await db.run(
            `
            UPDATE salesnav_sync_runs
            SET status = 'SUCCESS',
                last_error = NULL,
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [runId],
        );
        const run = await getSyncRunById(runId);
        if (!run) {
            throw new Error(`completeSyncRun: run ${runId} non trovata`);
        }
        return run;
    });
}

export async function failSyncRun(
    runId: number,
    errorMessage: string,
    finalProgress: Omit<UpdateSalesNavSyncRunProgressInput, 'runId'> = {},
): Promise<SalesNavSyncRunRecord> {
    const db = await getDatabase();
    const normalizedError = normalizeTextValue(errorMessage) || 'Unknown error';
    return withTransaction(db, async () => {
        if (Object.keys(finalProgress).length > 0) {
            await updateSyncRunProgress({ runId, ...finalProgress, lastError: normalizedError });
        }
        await db.run(
            `
            UPDATE salesnav_sync_runs
            SET status = 'FAILED',
                last_error = ?,
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [normalizedError, runId],
        );
        const run = await getSyncRunById(runId);
        if (!run) {
            throw new Error(`failSyncRun: run ${runId} non trovata`);
        }
        return run;
    });
}

export async function pauseSyncRun(
    runId: number,
    reason: string,
    finalProgress: Omit<UpdateSalesNavSyncRunProgressInput, 'runId'> = {},
): Promise<SalesNavSyncRunRecord> {
    const db = await getDatabase();
    const normalizedReason = normalizeTextValue(reason) || 'Paused';
    return withTransaction(db, async () => {
        if (Object.keys(finalProgress).length > 0) {
            await updateSyncRunProgress({ runId, ...finalProgress, lastError: normalizedReason });
        }
        await db.run(
            `
            UPDATE salesnav_sync_runs
            SET status = 'PAUSED',
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [normalizedReason, runId],
        );
        const run = await getSyncRunById(runId);
        if (!run) {
            throw new Error(`pauseSyncRun: run ${runId} non trovata`);
        }
        return run;
    });
}

export async function addSyncItem(input: AddSalesNavSyncItemInput): Promise<SalesNavSyncItemRecord> {
    const db = await getDatabase();
    const status = input.status ?? 'PENDING';
    const leadsOnPage = clampNonNegative(input.leadsOnPage, 0);
    const errorMessage = normalizeTextValue(input.errorMessage ?? '') || null;
    const savedAt = input.savedAt ?? (status === 'SUCCESS' ? new Date().toISOString() : null);

    return withTransaction(db, async () => {
        const existing = await db.get<SalesNavSyncItemRecord>(
            `
            SELECT
                id,
                run_id,
                search_index,
                page_number,
                leads_on_page,
                status,
                error_message,
                saved_at,
                created_at
            FROM salesnav_sync_items
            WHERE run_id = ?
              AND search_index = ?
              AND page_number = ?
            ORDER BY id DESC
            LIMIT 1
        `,
            [input.runId, input.searchIndex, input.pageNumber],
        );

        if (existing) {
            await db.run(
                `
                UPDATE salesnav_sync_items
                SET leads_on_page = ?,
                    status = ?,
                    error_message = ?,
                    saved_at = ?
                WHERE id = ?
            `,
                [leadsOnPage, status, errorMessage, savedAt, existing.id],
            );
            const updated = await db.get<SalesNavSyncItemRecord>(
                `
                SELECT
                    id,
                    run_id,
                    search_index,
                    page_number,
                    leads_on_page,
                    status,
                    error_message,
                    saved_at,
                    created_at
                FROM salesnav_sync_items
                WHERE id = ?
                LIMIT 1
            `,
                [existing.id],
            );
            if (!updated) {
                throw new Error(`addSyncItem: item ${existing.id} non trovato dopo update`);
            }
            return updated;
        }

        const result = await db.run(
            `
            INSERT INTO salesnav_sync_items (
                run_id,
                search_index,
                page_number,
                leads_on_page,
                status,
                error_message,
                saved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
            [input.runId, input.searchIndex, input.pageNumber, leadsOnPage, status, errorMessage, savedAt],
        );
        const inserted = await db.get<SalesNavSyncItemRecord>(
            `
            SELECT
                id,
                run_id,
                search_index,
                page_number,
                leads_on_page,
                status,
                error_message,
                saved_at,
                created_at
            FROM salesnav_sync_items
            WHERE id = ?
            LIMIT 1
        `,
            [result.lastID ?? 0],
        );
        if (!inserted) {
            throw new Error('addSyncItem: item non trovato dopo insert');
        }
        return inserted;
    });
}

export async function getResumableSyncRun(
    accountId: string,
    targetListName: string,
    searchName?: string | null,
): Promise<SalesNavSyncRunRecord | null> {
    const db = await getDatabase();
    const normalizedAccountId = normalizeTextValue(accountId) || 'default';
    const normalizedTargetListName = normalizeTextValue(targetListName);
    const normalizedSearchName = normalizeTextValue(searchName ?? '') || null;

    if (!normalizedTargetListName) {
        return null;
    }

    const row = normalizedSearchName
        ? await db.get<SalesNavSyncRunRecord>(
              `
            SELECT
                id,
                account_id,
                target_list_name,
                search_name,
                status,
                total_searches,
                processed_searches,
                total_pages,
                processed_pages,
                total_leads_saved,
                current_search_index,
                current_page_number,
                last_error,
                started_at,
                completed_at,
                updated_at
            FROM salesnav_sync_runs
            WHERE account_id = ?
              AND target_list_name = ?
              AND search_name = ?
              AND status IN ('RUNNING', 'PAUSED')
            ORDER BY started_at DESC, id DESC
            LIMIT 1
        `,
              [normalizedAccountId, normalizedTargetListName, normalizedSearchName],
          )
        : await db.get<SalesNavSyncRunRecord>(
              `
            SELECT
                id,
                account_id,
                target_list_name,
                search_name,
                status,
                total_searches,
                processed_searches,
                total_pages,
                processed_pages,
                total_leads_saved,
                current_search_index,
                current_page_number,
                last_error,
                started_at,
                completed_at,
                updated_at
            FROM salesnav_sync_runs
            WHERE account_id = ?
              AND target_list_name = ?
              AND status IN ('RUNNING', 'PAUSED')
            ORDER BY started_at DESC, id DESC
            LIMIT 1
        `,
              [normalizedAccountId, normalizedTargetListName],
          );

    return row ?? null;
}

export async function getSyncRunSummary(runId: number): Promise<SalesNavSyncRunSummary | null> {
    const run = await getSyncRunById(runId);
    if (!run) {
        return null;
    }

    const items = await getSyncRunItems(runId);
    const counts = {
        total: items.length,
        success: items.filter((item) => item.status === 'SUCCESS').length,
        failed: items.filter((item) => item.status === 'FAILED').length,
        pending: items.filter((item) => item.status === 'PENDING').length,
        skipped: items.filter((item) => item.status === 'SKIPPED').length,
    };

    const bySearchMap = new Map<
        number,
        {
            searchIndex: number;
            processedPages: number;
            successfulPages: number;
            failedPages: number;
            leadsSaved: number;
            lastPageNumber: number;
        }
    >();

    for (const item of items) {
        const current = bySearchMap.get(item.search_index) ?? {
            searchIndex: item.search_index,
            processedPages: 0,
            successfulPages: 0,
            failedPages: 0,
            leadsSaved: 0,
            lastPageNumber: 0,
        };
        current.processedPages += 1;
        if (item.status === 'SUCCESS') {
            current.successfulPages += 1;
            current.leadsSaved += Math.max(0, item.leads_on_page ?? 0);
        }
        if (item.status === 'FAILED') {
            current.failedPages += 1;
        }
        current.lastPageNumber = Math.max(current.lastPageNumber, item.page_number);
        bySearchMap.set(item.search_index, current);
    }

    return {
        run,
        items,
        counts,
        bySearch: Array.from(bySearchMap.values()).sort((left, right) => left.searchIndex - right.searchIndex),
    };
}
