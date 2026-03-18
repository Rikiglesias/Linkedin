/**
 * CLI command handlers per i 4 workflow production-ready.
 */

import { hasOption, getOptionValue } from '../cliParser';
import { runSyncListWorkflow } from '../../workflows/syncListWorkflow';
import { runSyncSearchWorkflow } from '../../workflows/syncSearchWorkflow';
import { runSendMessagesWorkflow } from '../../workflows/sendMessagesWorkflow';
import { runSendInvitesWorkflow } from '../../workflows/sendInvitesWorkflow';

// ─── sync-list ───────────────────────────────────────────────────────────────

export async function runSyncListCommand(args: string[]): Promise<void> {
    // Passa la stringa intera a runSyncListWorkflow — matchesListNameFilter supporta
    // filtri multipli separati da virgola, evitando di aprire N browser separati.
    await runSyncListWorkflow({
        listName: getOptionValue(args, '--list') ?? undefined,
        listUrl: getOptionValue(args, '--url') ?? undefined,
        maxPages: parseOptionalInt(getOptionValue(args, '--max-pages')),
        maxLeads: parseOptionalInt(getOptionValue(args, '--max-leads') ?? getOptionValue(args, '--limit')),
        enrichment: hasOption(args, '--no-enrich') ? false : undefined,
        dryRun: hasOption(args, '--dry-run'),
        interactive: hasOption(args, '--interactive') || hasOption(args, '-i'),
        accountId: getOptionValue(args, '--account') ?? undefined,
        noProxy: hasOption(args, '--no-proxy'),
        skipPreflight: hasOption(args, '--skip-preflight'),
    });
}

// ─── sync-search ─────────────────────────────────────────────────────────────

export async function runSyncSearchCommand(args: string[]): Promise<void> {
    await runSyncSearchWorkflow({
        searchName: getOptionValue(args, '--search-name') ?? undefined,
        listName: getOptionValue(args, '--list') ?? undefined,
        maxPages: parseOptionalInt(getOptionValue(args, '--max-pages')),
        limit: parseOptionalInt(getOptionValue(args, '--limit')),
        enrichment: hasOption(args, '--no-enrich') ? false : undefined,
        dryRun: hasOption(args, '--dry-run'),
        accountId: getOptionValue(args, '--account') ?? undefined,
        noProxy: hasOption(args, '--no-proxy'),
        skipPreflight: hasOption(args, '--skip-preflight'),
    });
}

// ─── send-messages ───────────────────────────────────────────────────────────

export async function runSendMessagesCommand(args: string[]): Promise<void> {
    await runSendMessagesWorkflow({
        listName: getOptionValue(args, '--list') ?? undefined,
        template: getOptionValue(args, '--template') ?? undefined,
        lang: getOptionValue(args, '--lang') ?? undefined,
        limit: parseOptionalInt(getOptionValue(args, '--limit')),
        dryRun: hasOption(args, '--dry-run'),
        skipPreflight: hasOption(args, '--skip-preflight'),
        accountId: getOptionValue(args, '--account') ?? undefined,
        skipEnrichment: hasOption(args, '--no-enrich'),
    });
}

// ─── send-invites ────────────────────────────────────────────────────────────

export async function runSendInvitesCommand(args: string[]): Promise<void> {
    const noteMode = getOptionValue(args, '--note') as 'ai' | 'template' | 'none' | undefined;
    await runSendInvitesWorkflow({
        listName: getOptionValue(args, '--list') ?? undefined,
        noteMode: noteMode && ['ai', 'template', 'none'].includes(noteMode) ? noteMode : undefined,
        minScore: parseOptionalInt(getOptionValue(args, '--min-score')),
        limit: parseOptionalInt(getOptionValue(args, '--limit')),
        dryRun: hasOption(args, '--dry-run'),
        skipPreflight: hasOption(args, '--skip-preflight'),
        accountId: getOptionValue(args, '--account') ?? undefined,
        skipEnrichment: hasOption(args, '--no-enrich'),
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseOptionalInt(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
