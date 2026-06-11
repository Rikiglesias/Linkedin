import { beforeEach, describe, expect, test, vi } from 'vitest';

// G4-parte2: characterization test delle unità estratte dallo split G5-F3 di
// runSalesNavigatorListSync (resolveSyncTarget / restoreListCheckpoint / upsertLeadBatch /
// processSingleListSync). Fotografano il comportamento ATTUALE (post-split = pre-split,
// verificato move-only) per proteggere i refactor futuri del file.

const mocks = vi.hoisted(() => ({
    getAccountProfileById: vi.fn(),
    cleanLeadDataWithAI: vi.fn(),
    scoreLeadProfile: vi.fn(),
    checkLogin: vi.fn(),
    closeBrowser: vi.fn(),
    detectChallenge: vi.fn(),
    humanDelay: vi.fn(),
    launchBrowser: vi.fn(),
    attemptChallengeResolution: vi.fn(),
    awaitManualLogin: vi.fn(),
    blockUserInput: vi.fn(),
    enableWindowClickThrough: vi.fn(),
    disableWindowClickThrough: vi.fn(),
    batchUpsertCloudLeads: vi.fn(),
    syncSalesNavMembersToCloud: vi.fn(),
    getDatabase: vi.fn(),
    enrichLeadAuto: vi.fn(),
    handleChallengeDetected: vi.fn(),
    navigateToSavedLists: vi.fn(),
    scrapeLeadsFromSalesNavList: vi.fn(),
    getLeadById: vi.fn(),
    getLeadByLinkedinUrl: vi.fn(),
    getListScoringCriteria: vi.fn(),
    getRuntimeFlag: vi.fn(),
    linkLeadToSalesNavList: vi.fn(),
    markSalesNavListSynced: vi.fn(),
    setRuntimeFlag: vi.fn(),
    updateLeadScores: vi.fn(),
    upsertSalesNavList: vi.fn(),
    upsertSalesNavigatorLead: vi.fn(),
    pushOutboxEvent: vi.fn(),
}));

vi.mock('../accountManager', () => ({ getAccountProfileById: mocks.getAccountProfileById }));
vi.mock('../security/redaction', () => ({
    maskName: (v: unknown) => v,
    maskEmail: (v: unknown) => v,
    maskPhone: (v: unknown) => v,
}));
vi.mock('../ai/leadDataCleaner', () => ({ cleanLeadDataWithAI: mocks.cleanLeadDataWithAI }));
vi.mock('../ai/leadScorer', () => ({ scoreLeadProfile: mocks.scoreLeadProfile }));
vi.mock('../browser', () => ({
    checkLogin: mocks.checkLogin,
    closeBrowser: mocks.closeBrowser,
    detectChallenge: mocks.detectChallenge,
    humanDelay: mocks.humanDelay,
    launchBrowser: mocks.launchBrowser,
}));
vi.mock('../workers/challengeHandler', () => ({ attemptChallengeResolution: mocks.attemptChallengeResolution }));
vi.mock('../browser/humanBehavior', () => ({
    awaitManualLogin: mocks.awaitManualLogin,
    blockUserInput: mocks.blockUserInput,
}));
vi.mock('../browser/windowInputBlock', () => ({
    enableWindowClickThrough: mocks.enableWindowClickThrough,
    disableWindowClickThrough: mocks.disableWindowClickThrough,
}));
vi.mock('../cloud/supabaseDataClient', () => ({
    batchUpsertCloudLeads: mocks.batchUpsertCloudLeads,
    syncSalesNavMembersToCloud: mocks.syncSalesNavMembersToCloud,
}));
vi.mock('../config', () => ({ config: { headless: true, supabaseSyncEnabled: false } }));
vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('../integrations/leadEnricher', () => ({ enrichLeadAuto: mocks.enrichLeadAuto }));
vi.mock('../risk/incidentManager', () => ({ handleChallengeDetected: mocks.handleChallengeDetected }));
vi.mock('../salesnav/listScraper', () => ({
    navigateToSavedLists: mocks.navigateToSavedLists,
    scrapeLeadsFromSalesNavList: mocks.scrapeLeadsFromSalesNavList,
}));
vi.mock('../core/repositories', () => ({
    getLeadById: mocks.getLeadById,
    getLeadByLinkedinUrl: mocks.getLeadByLinkedinUrl,
    getListScoringCriteria: mocks.getListScoringCriteria,
    getRuntimeFlag: mocks.getRuntimeFlag,
    linkLeadToSalesNavList: mocks.linkLeadToSalesNavList,
    markSalesNavListSynced: mocks.markSalesNavListSynced,
    setRuntimeFlag: mocks.setRuntimeFlag,
    updateLeadScores: mocks.updateLeadScores,
    upsertSalesNavList: mocks.upsertSalesNavList,
    upsertSalesNavigatorLead: mocks.upsertSalesNavigatorLead,
    pushOutboxEvent: mocks.pushOutboxEvent,
}));

import {
    processSingleListSync,
    resolveSyncTarget,
    restoreListCheckpoint,
    upsertLeadBatch,
    type SalesNavigatorSyncListReport,
} from '../core/salesNavigatorSync';

type LeadCandidate = Parameters<typeof upsertLeadBatch>[0][number];
type ListRow = Parameters<typeof upsertLeadBatch>[1];
type Session = Parameters<typeof processSingleListSync>[0];

function buildCandidate(overrides: Record<string, unknown> = {}): LeadCandidate {
    return {
        linkedinUrl: 'https://www.linkedin.com/in/mario-rossi',
        publicProfileUrl: null,
        accountName: 'ACME',
        firstName: 'Mario',
        lastName: 'Rossi',
        jobTitle: 'CEO',
        website: null,
        location: 'Milano',
        ...overrides,
    } as unknown as LeadCandidate;
}

function emptyListReport(listName = 'Lista A', listUrl = 'https://ln.test/lists/a'): SalesNavigatorSyncListReport {
    return {
        listName,
        listUrl,
        pagesVisited: 0,
        candidatesDiscovered: 0,
        uniqueCandidates: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        wouldInsert: 0,
        wouldUpdate: 0,
        errors: 0,
        samples: [],
    };
}

function buildSession(): Session {
    return { page: {}, browser: {} } as unknown as Session;
}

function buildScraped(overrides: Record<string, unknown> = {}) {
    return {
        pagesVisited: 2,
        candidatesDiscovered: 30,
        uniqueCandidates: 25,
        leads: [],
        scrapeDegraded: false,
        ...overrides,
    };
}

describe('resolveSyncTarget (characterization)', () => {
    test('URL http(s) valido → navigazione diretta, nessun filtro-nome implicito', () => {
        const target = resolveSyncTarget({
            listUrl: ' https://www.linkedin.com/sales/lists/x ',
            listName: null,
            maxPages: 5,
            maxLeadsPerList: 100,
            dryRun: false,
        });
        expect(target.explicitListUrl).toBe('https://www.linkedin.com/sales/lists/x');
        expect(target.listFilter).toBeNull();
        expect(target.maxPages).toBe(5);
        expect(target.maxLeadsPerList).toBe(100);
    });

    test('testo non-URL nel campo URL → diventa filtro-nome, NIENTE page.goto (fix Invalid url)', () => {
        const target = resolveSyncTarget({
            listUrl: 'EVENTI EU DA 1-50',
            listName: null,
            maxPages: 3,
            maxLeadsPerList: 50,
            dryRun: false,
        });
        expect(target.explicitListUrl).toBeNull();
        expect(target.listFilter).toBe('EVENTI EU DA 1-50');
    });

    test('listName esplicito ha precedenza come filtro; limiti clampati a minimo 1', () => {
        const target = resolveSyncTarget({
            listUrl: null,
            listName: 'Lista A',
            maxPages: 0,
            maxLeadsPerList: -5,
            dryRun: false,
        });
        expect(target.listFilter).toBe('Lista A');
        expect(target.maxPages).toBe(1);
        expect(target.maxLeadsPerList).toBe(1);
    });
});

describe('restoreListCheckpoint (characterization)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('nessun checkpoint → set vuoto, chiave per-account con suffisso "all"', async () => {
        mocks.getRuntimeFlag.mockResolvedValue(null);
        const result = await restoreListCheckpoint('acc-1', null);
        expect(result.checkpointKey).toBe('sync_list_checkpoint:acc-1:all');
        expect(result.completedListNames.size).toBe(0);
    });

    test('checkpoint valido → set popolato; listName nel suffisso chiave', async () => {
        mocks.getRuntimeFlag.mockResolvedValue('["Lista A","Lista B"]');
        const result = await restoreListCheckpoint('acc-1', 'Lista A');
        expect(result.checkpointKey).toBe('sync_list_checkpoint:acc-1:Lista A');
        expect([...result.completedListNames]).toEqual(['Lista A', 'Lista B']);
    });

    test('checkpoint corrotto → riparte da zero senza lanciare', async () => {
        mocks.getRuntimeFlag.mockResolvedValue('{garbage[');
        const result = await restoreListCheckpoint('acc-1', null);
        expect(result.completedListNames.size).toBe(0);
    });
});

describe('upsertLeadBatch (characterization)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getLeadByLinkedinUrl.mockResolvedValue(null);
        mocks.upsertSalesNavigatorLead.mockResolvedValue({ leadId: 11, action: 'inserted' });
        mocks.linkLeadToSalesNavList.mockResolvedValue(undefined);
    });

    test('dryRun: conta would-insert/would-update SENZA scrivere su DB', async () => {
        mocks.getLeadByLinkedinUrl
            .mockResolvedValueOnce({ id: 7 }) // esistente → wouldUpdate
            .mockResolvedValueOnce(null); // nuovo → wouldInsert
        const listReport = emptyListReport();

        const synced = await upsertLeadBatch(
            [buildCandidate(), buildCandidate({ linkedinUrl: 'https://www.linkedin.com/in/anna-bianchi' })],
            null,
            'Lista A',
            true,
            listReport,
        );

        expect(synced).toEqual([]);
        expect(listReport.wouldUpdate).toBe(1);
        expect(listReport.wouldInsert).toBe(1);
        expect(mocks.upsertSalesNavigatorLead).not.toHaveBeenCalled();
        expect(mocks.linkLeadToSalesNavList).not.toHaveBeenCalled();
    });

    test('contatori inserted/updated/unchanged + link alla lista + id sincronizzati', async () => {
        mocks.upsertSalesNavigatorLead
            .mockResolvedValueOnce({ leadId: 11, action: 'inserted' })
            .mockResolvedValueOnce({ leadId: 12, action: 'updated' })
            .mockResolvedValueOnce({ leadId: 13, action: 'unchanged' });
        const listReport = emptyListReport();

        const synced = await upsertLeadBatch(
            [buildCandidate(), buildCandidate(), buildCandidate()],
            { id: 99 } as unknown as ListRow,
            'Lista A',
            false,
            listReport,
        );

        expect(synced).toEqual([11, 12, 13]);
        expect(listReport.inserted).toBe(1);
        expect(listReport.updated).toBe(1);
        expect(listReport.unchanged).toBe(1);
        expect(mocks.linkLeadToSalesNavList).toHaveBeenCalledTimes(3);
        expect(mocks.linkLeadToSalesNavList).toHaveBeenCalledWith(99, 11);
    });

    test('errore su un candidato → errors++ e si CONTINUA col successivo (no abort batch)', async () => {
        mocks.upsertSalesNavigatorLead
            .mockRejectedValueOnce(new Error('db locked'))
            .mockResolvedValueOnce({ leadId: 12, action: 'inserted' });
        const listReport = emptyListReport();

        const synced = await upsertLeadBatch([buildCandidate(), buildCandidate()], null, 'Lista A', false, listReport);

        expect(listReport.errors).toBe(1);
        expect(listReport.inserted).toBe(1);
        expect(synced).toEqual([12]);
    });

    test('samples cap a 10 anche con più candidati', async () => {
        const candidates = Array.from({ length: 12 }, (_, i) =>
            buildCandidate({ linkedinUrl: `https://www.linkedin.com/in/p${i}` }),
        );
        const listReport = emptyListReport();

        await upsertLeadBatch(candidates, null, 'Lista A', false, listReport);

        expect(listReport.samples.length).toBe(10);
    });

    test('preferenza URL pubblico /in/ + salesnavUrl preservato per URL /sales/lead/', async () => {
        const listReport = emptyListReport();
        await upsertLeadBatch(
            [
                buildCandidate({
                    linkedinUrl: 'https://www.linkedin.com/sales/lead/ACw123',
                    publicProfileUrl: 'https://www.linkedin.com/in/mario-rossi',
                }),
            ],
            null,
            'Lista A',
            false,
            listReport,
        );

        expect(mocks.upsertSalesNavigatorLead).toHaveBeenCalledWith(
            expect.objectContaining({
                linkedinUrl: 'https://www.linkedin.com/in/mario-rossi',
                salesnavUrl: 'https://www.linkedin.com/sales/lead/ACw123',
            }),
        );
    });
});

describe('processSingleListSync (characterization)', () => {
    const limits = { explicitListUrl: null, listFilter: null, maxPages: 3, maxLeadsPerList: 50 };
    const targetList = { name: 'Lista A', url: 'https://ln.test/lists/a' };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.scrapeLeadsFromSalesNavList.mockResolvedValue(buildScraped());
        mocks.detectChallenge.mockResolvedValue(false);
        mocks.upsertSalesNavList.mockResolvedValue({ id: 99 });
        mocks.upsertSalesNavigatorLead.mockResolvedValue({ leadId: 11, action: 'inserted' });
        mocks.linkLeadToSalesNavList.mockResolvedValue(undefined);
        mocks.markSalesNavListSynced.mockResolvedValue(undefined);
        mocks.handleChallengeDetected.mockResolvedValue(1);
        mocks.humanDelay.mockResolvedValue(undefined);
    });

    test('challenge NON risolto → challengeAborted, incident notificato, NESSUN upsert lista', async () => {
        mocks.detectChallenge.mockResolvedValue(true);
        mocks.attemptChallengeResolution.mockResolvedValue(false);

        const outcome = await processSingleListSync(buildSession(), 'acc-1', targetList, limits, false, false);

        expect(outcome.challengeAborted).toBe(true);
        expect(outcome.syncedLeadIds).toEqual([]);
        expect(mocks.handleChallengeDetected).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'salesnav_sync', accountId: 'acc-1' }),
        );
        expect(mocks.upsertSalesNavList).not.toHaveBeenCalled();
        // I contatori scrape restano nel listReport (il caller li aggrega anche su abort)
        expect(outcome.listReport.pagesVisited).toBe(2);
    });

    test('scrape degradato → errors=1, lista NON marcata synced, flag per il checkpoint', async () => {
        mocks.scrapeLeadsFromSalesNavList.mockResolvedValue(buildScraped({ scrapeDegraded: true, leads: [] }));

        const outcome = await processSingleListSync(buildSession(), 'acc-1', targetList, limits, false, false);

        expect(outcome.scrapeDegraded).toBe(true);
        expect(outcome.listReport.errors).toBe(1);
        expect(mocks.markSalesNavListSynced).not.toHaveBeenCalled();
    });

    test('happy path → lead upsertati, lista marcata synced, contatori dal listScraper', async () => {
        mocks.scrapeLeadsFromSalesNavList.mockResolvedValue(buildScraped({ leads: [buildCandidate()] }));

        const outcome = await processSingleListSync(buildSession(), 'acc-1', targetList, limits, false, false);

        expect(outcome.challengeAborted).toBe(false);
        expect(outcome.scrapeDegraded).toBe(false);
        expect(outcome.syncedLeadIds).toEqual([11]);
        expect(outcome.listReport.inserted).toBe(1);
        expect(outcome.listReport.pagesVisited).toBe(2);
        expect(outcome.listReport.uniqueCandidates).toBe(25);
        expect(mocks.markSalesNavListSynced).toHaveBeenCalledWith(99);
        // I limiti passano al listScraper così come risolti (clamp già fatto da resolveSyncTarget)
        expect(mocks.scrapeLeadsFromSalesNavList).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ maxPages: 3, leadLimit: 50 }),
        );
    });

    test('dryRun → nessuna scrittura: niente upsert lista né mark synced', async () => {
        mocks.scrapeLeadsFromSalesNavList.mockResolvedValue(buildScraped({ leads: [buildCandidate()] }));

        const outcome = await processSingleListSync(buildSession(), 'acc-1', targetList, limits, true, false);

        expect(mocks.upsertSalesNavList).not.toHaveBeenCalled();
        expect(mocks.markSalesNavListSynced).not.toHaveBeenCalled();
        expect(outcome.listReport.wouldInsert).toBe(1);
    });
});
