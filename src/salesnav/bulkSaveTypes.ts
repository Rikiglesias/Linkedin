/**
 * salesnav/bulkSaveTypes.ts — Tipi condivisi per il sistema bulk save SalesNav.
 * Estratti da bulkSaveOrchestrator.ts (A17: split file >1000 righe).
 */

import type { SalesNavSyncRunSummary } from '../core/repositories.types';

export interface SalesNavBulkSaveOptions {
    accountId: string;
    targetListName: string;
    maxPages: number;
    maxSearches?: number | null;
    searchName?: string | null;
    resume?: boolean;
    dryRun?: boolean;
    sessionLimit?: number | null;
}

export interface SalesNavBulkSavePageReport {
    pageNumber: number;
    leadsOnPage: number;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'SKIPPED_ALL_SAVED';
    errorMessage: string | null;
    allAlreadySaved?: boolean;
}

export interface SalesNavBulkSaveSearchReport {
    searchIndex: number;
    searchName: string;
    startedPage: number;
    finalPage: number;
    processedPages: number;
    pagesSkippedAllSaved: number;
    leadsSaved: number;
    totalResultsDetected: number | null;
    status: 'SUCCESS' | 'SKIPPED_AFTER_FAILURES' | 'FAILED_TO_OPEN' | 'DRY_RUN';
    errors: string[];
    pages: SalesNavBulkSavePageReport[];
}

export interface SalesNavBulkSaveReport {
    runId: number | null;
    accountId: string;
    targetListName: string;
    dryRun: boolean;
    resumeRequested: boolean;
    resumedFromRunId: number | null;
    status: 'SUCCESS' | 'FAILED' | 'PAUSED' | 'DRY_RUN';
    challengeDetected: boolean;
    sessionLimitHit: boolean;
    searchesDiscovered: number;
    searchesPlanned: number;
    searchesProcessed: number;
    pagesProcessed: number;
    pagesSkippedAllSaved: number;
    totalLeadsSaved: number;
    lastError: string | null;
    startedAt: string;
    finishedAt: string | null;
    searches: SalesNavBulkSaveSearchReport[];
    dbSummary: SalesNavSyncRunSummary | null;
}

export interface SavedSearchDescriptor {
    index: number;
    name: string;
    buttonText: string;
}

export interface ScrollResult {
    leads: Map<string, { leadId: string; firstName: string; lastName: string; linkedinUrl: string; title: string; company: string; location: string }>;
    totalFound: number;
}

export class BulkSaveChallengeDetectedError extends Error {
    constructor(message: string = 'Challenge rilevato durante Sales Navigator bulk save') {
        super(message);
        this.name = 'ChallengeDetectedError';
    }
}
