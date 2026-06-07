/**
 * Suite H20 — Unit test per i 3 worker d'azione.
 * Tutti i moduli con I/O reale (DB, browser, AI, network) sono mockati.
 * Si testa solo la logica di controllo: status guard, budget gate, state transition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock globali PRIMA degli import dei moduli sotto test ───────────────────

// Telemetria — no side effects
vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn().mockResolvedValue(undefined),
    logWarn: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
}));

// Repositories — DB mockato
vi.mock('../core/repositories', () => ({
    checkAndIncrementDailyLimit: vi.fn().mockResolvedValue(true),
    incrementDailyStat: vi.fn().mockResolvedValue(undefined),
    incrementListDailyStat: vi.fn().mockResolvedValue(undefined),
    recordLeadTimingAttribution: vi.fn().mockResolvedValue(undefined),
    updateLeadPromptVariant: vi.fn().mockResolvedValue(undefined),
    updateLeadScrapedContext: vi.fn().mockResolvedValue(undefined),
    getDailyStat: vi.fn().mockResolvedValue(0),
    getLeadById: vi.fn(),
    storeMessageHash: vi.fn().mockResolvedValue(undefined),
    countRecentMessageHash: vi.fn().mockResolvedValue(0),
    getLeadEnrichmentSummary: vi.fn().mockResolvedValue(null),
    hashMessage: vi.fn().mockReturnValue('hash-abc'),
}));

// leadsCore (usato da inviteWorker via import separato)
vi.mock('../core/repositories/leadsCore', () => ({
    getLeadById: vi.fn(),
}));

// blacklist
vi.mock('../core/repositories/blacklist', () => ({
    isBlacklisted: vi.fn().mockResolvedValue(false),
}));

// auditLog
vi.mock('../core/repositories/auditLog', () => ({
    writeAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

// prebuiltMessages
vi.mock('../core/repositories/prebuiltMessages', () => ({
    getUnusedPrebuiltMessage: vi.fn().mockResolvedValue(null),
    markPrebuiltMessageUsed: vi.fn().mockResolvedValue(undefined),
}));

// leadStateService — transitionLead, transitionLeadAtomic, isValidLeadTransition
vi.mock('../core/leadStateService', () => ({
    transitionLead: vi.fn().mockResolvedValue(undefined),
    transitionLeadAtomic: vi.fn().mockResolvedValue(undefined),
    isValidLeadTransition: vi.fn().mockReturnValue(true),
}));

// browser — tutto mockato
vi.mock('../browser', () => ({
    clickLocatorHumanLike: vi.fn().mockResolvedValue(undefined),
    clickWithFallback: vi.fn().mockResolvedValue(undefined),
    contextualReadingPause: vi.fn().mockResolvedValue(undefined),
    detectChallenge: vi.fn().mockResolvedValue(false),
    dismissKnownOverlays: vi.fn().mockResolvedValue(undefined),
    humanDelay: vi.fn().mockResolvedValue(undefined),
    humanMouseMove: vi.fn().mockResolvedValue(undefined),
    humanType: vi.fn().mockResolvedValue(undefined),
    simulateHumanReading: vi.fn().mockResolvedValue(undefined),
    typeWithFallback: vi.fn().mockResolvedValue(undefined),
}));

// humanBehavior
vi.mock('../browser/humanBehavior', () => ({
    ensureViewportDwell: vi.fn().mockResolvedValue(undefined),
    computeProfileDwellTime: vi.fn().mockResolvedValue(undefined),
}));

// navigationContext
vi.mock('../browser/navigationContext', () => ({
    navigateToProfileWithContext: vi.fn().mockResolvedValue({ success: true }),
    navigateToProfileForMessage: vi.fn().mockResolvedValue({ success: true }),
    navigateToProfileForCheck: vi.fn().mockResolvedValue({ success: true }),
}));

// auth
vi.mock('../browser/auth', () => ({
    isLoggedIn: vi.fn().mockResolvedValue(true),
}));

// observePageContext
vi.mock('../browser/observePageContext', () => ({
    observePageContext: vi.fn().mockResolvedValue({
        profileName: 'Test Lead',
        profileHeadline: 'CEO',
        connectionDegree: '2nd',
        isProfileDeleted: false,
        hasModalOpen: false,
        hasChallenge: false,
        currentUrl: 'https://www.linkedin.com/in/test/',
        hasConnectButton: true,
        hasMessageButton: false,
        hasPendingIndicator: false,
    }),
    logObservation: vi.fn().mockResolvedValue(undefined),
}));

// aiDecisionEngine — sempre PROCEED
vi.mock('../ai/aiDecisionEngine', () => ({
    aiDecide: vi.fn().mockResolvedValue({
        action: 'PROCEED',
        confidence: 0.9,
        reason: 'test-mock',
        suggestedDelaySec: 0,
        navigationStrategy: undefined,
    }),
}));

// linkedinUrl
vi.mock('../linkedinUrl', () => ({
    isSalesNavigatorUrl: vi.fn().mockReturnValue(false),
}));

// selectors — ogni nome di selettore ottiene un valore distinto
vi.mock('../selectors', () => ({
    joinSelectors: vi.fn().mockImplementation((name: string) => `.sel-${name}`),
    SELECTORS: {
        messageButton: '.sel-messageButton',
        messageSendButton: '.sel-messageSendButton',
        messageTextbox: '.sel-messageTextbox',
    },
}));

// config
vi.mock('../config', () => ({
    config: {
        hardInviteCap: 20,
        hardMsgCap: 20,
        inviteWithNote: false,
        profileContextExtractionEnabled: false,
        aiPersonalizationEnabled: false,
    },
}));

// AI personalization — template fallback
vi.mock('../ai/inviteNotePersonalizer', () => ({
    buildPersonalizedInviteNote: vi.fn().mockResolvedValue({ note: 'Ciao!', source: 'template', variant: 'TPL_TEST' }),
}));

vi.mock('../ai/messagePersonalizer', () => ({
    buildPersonalizedFollowUpMessage: vi.fn().mockResolvedValue({
        message: 'Ciao! Volevo ringraziarti per aver accettato la mia connessione.',
        source: 'template',
        model: null,
    }),
}));

// messages (template builder)
vi.mock('../messages', () => ({
    buildFollowUpMessage: vi.fn().mockReturnValue('Messaggio template test'),
}));

// messageValidator
vi.mock('../validation/messageValidator', () => ({
    hashMessage: vi.fn().mockReturnValue('hash-abc'),
    validateMessageContentAsync: vi.fn().mockResolvedValue({ valid: true, reasons: [] }),
}));

// sessionDataHelper (dynamic import)
vi.mock('../workers/sessionDataHelper', () => ({
    buildSessionSnapshot: vi.fn().mockResolvedValue({ sessionActionCount: 0 }),
}));

// chatMessageExtractor (dynamic import)
vi.mock('../workers/chatMessageExtractor', () => ({
    extractRecentChatMessages: vi.fn().mockResolvedValue([]),
}));

// risk/incidentManager
vi.mock('../risk/incidentManager', () => ({
    pauseAutomation: vi.fn().mockResolvedValue(undefined),
}));

// cloud/cloudBridge
vi.mock('../cloud/cloudBridge', () => ({
    bridgeDailyStat: vi.fn(),
    bridgeLeadStatus: vi.fn(),
}));

// ml/abBandit
vi.mock('../ml/abBandit', () => ({
    recordSent: vi.fn().mockResolvedValue(undefined),
    recordOutcome: vi.fn().mockResolvedValue(undefined),
    inferHourBucket: vi.fn().mockReturnValue('morning'),
}));

// ml/segments
vi.mock('../ml/segments', () => ({
    inferLeadSegment: vi.fn().mockReturnValue('generic'),
}));

// utils/text
vi.mock('../utils/text', () => ({
    normalizeNameForComparison: vi.fn().mockImplementation((s: string) => s.toLowerCase().trim()),
    jaroWinklerSimilarity: vi.fn().mockReturnValue(0.95),
}));

// challengeHandler
vi.mock('../workers/challengeHandler', () => ({
    attemptChallengeResolution: vi.fn().mockResolvedValue(true),
}));

// ─── Import moduli sotto test (DOPO i mock) ──────────────────────────────────
import { processInviteJob } from '../workers/inviteWorker';
import { processMessageJob } from '../workers/messageWorker';
import { processAcceptanceJob } from '../workers/acceptanceWorker';
import type { LeadRecord, InviteJobPayload, MessageJobPayload, AcceptanceJobPayload } from '../types/domain';
import type { WorkerContext } from '../workers/context';
import { transitionLead, transitionLeadAtomic } from '../core/leadStateService';
import { checkAndIncrementDailyLimit, getDailyStat } from '../core/repositories';
// leadsCore è usato da inviteWorker per getLeadById
import { getLeadById as getLeadByIdCore } from '../core/repositories/leadsCore';
// repositories ha anche getLeadById usato da messageWorker e acceptanceWorker
import { getLeadById } from '../core/repositories';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
    return {
        id: 42,
        account_name: 'Acme Corp',
        first_name: 'Mario',
        last_name: 'Rossi',
        job_title: 'CEO',
        website: 'https://acme.com',
        linkedin_url: 'https://www.linkedin.com/in/mario-rossi/',
        status: 'READY_INVITE',
        list_name: 'lista-test',
        invited_at: null,
        accepted_at: null,
        messaged_at: null,
        follow_up_count: 0,
        last_error: null,
        blocked_reason: null,
        about: null,
        experience: null,
        invite_prompt_variant: null,
        lead_score: null,
        confidence_score: null,
        email: null,
        phone: null,
        location: null,
        salesnav_url: null,
        company_domain: null,
        business_email: null,
        business_email_confidence: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: null,
        ...overrides,
    };
}

/**
 * Crea un page mock dipendente dal selettore CSS.
 * Params:
 *   connectCount   — quante volte il bottone Connect è trovato (default 0)
 *   modalVisible   — se il modale di invito è visibile dopo click (default false)
 *   textboxValue   — contenuto restituito da inputValue della textbox msg (default '')
 *   distanceBadge  — testo del badge distanza (default '' = non trovato)
 */
function makePage(opts: {
    connectCount?: number;
    modalVisible?: boolean;
    textboxValue?: string;
    distanceBadge?: string;
} = {}) {
    const {
        connectCount = 0,
        modalVisible = false,
        textboxValue = '',
        distanceBadge = '',
    } = opts;

    const makeLocatorResult = (cnt: number, txt: string, visible: boolean, inputVal: string) => ({
        count: vi.fn().mockResolvedValue(cnt),
        first: () => ({
            count: vi.fn().mockResolvedValue(cnt),
            isVisible: vi.fn().mockResolvedValue(visible),
            isDisabled: vi.fn().mockResolvedValue(false),
            textContent: vi.fn().mockResolvedValue(txt),
            innerText: vi.fn().mockResolvedValue(txt),
            inputValue: vi.fn().mockResolvedValue(inputVal),
        }),
        last: () => ({
            isVisible: vi.fn().mockResolvedValue(false),
            innerText: vi.fn().mockResolvedValue(''),
        }),
        isVisible: vi.fn().mockResolvedValue(visible),
    });

    return {
        locator: vi.fn().mockImplementation((selector: string) => {
            if (selector === '.sel-connectButtonPrimary') {
                return makeLocatorResult(connectCount, 'Connect', connectCount > 0, '');
            }
            if (
                selector.includes('sel-addNoteButton') ||
                selector.includes('sel-sendWithoutNote') ||
                selector.includes('sel-sendFallback')
            ) {
                return makeLocatorResult(modalVisible ? 1 : 0, '', modalVisible, '');
            }
            if (selector === '.sel-messageTextbox') {
                return makeLocatorResult(1, '', true, textboxValue);
            }
            if (selector === '.sel-messageSendButton') {
                return makeLocatorResult(1, 'Message', true, '');
            }
            if (selector === '.sel-messageButton') {
                return makeLocatorResult(1, 'Message', true, '');
            }
            if (selector === '.sel-distanceBadge') {
                const hasBadge = distanceBadge.length > 0;
                return makeLocatorResult(hasBadge ? 1 : 0, distanceBadge, hasBadge, '');
            }
            // h1 per identity check
            if (selector === 'h1') {
                return makeLocatorResult(1, 'Mario Rossi', true, '');
            }
            // default — non trovato
            return makeLocatorResult(0, '', false, '');
        }),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        textContent: vi.fn().mockResolvedValue(''),
        url: vi.fn().mockReturnValue('https://www.linkedin.com/in/mario-rossi/'),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        evaluate: vi.fn().mockResolvedValue(undefined),
    };
}

function makeContext(overrides: Partial<WorkerContext> = {}): WorkerContext {
    return {
        session: { page: makePage() } as unknown as WorkerContext['session'],
        dryRun: true, // dry run di default: no real LinkedIn actions
        localDate: '2025-06-07',
        accountId: 'account-test',
        visitedProfilesToday: new Set<string>(),
        sessionActionCount: 0,
        ...overrides,
    } as WorkerContext;
}

// ─── inviteWorker ─────────────────────────────────────────────────────────────

describe('inviteWorker — processInviteJob', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: lead READY_INVITE trovato
        vi.mocked(getLeadByIdCore).mockResolvedValue(makeLead({ status: 'READY_INVITE' }));
        vi.mocked(checkAndIncrementDailyLimit).mockResolvedValue(true);
        vi.mocked(transitionLead).mockResolvedValue(undefined);
    });

    const basePayload: InviteJobPayload = { leadId: 42, localDate: '2025-06-07' };

    // (4) verify pre/post: status guard — status inatteso → no-op (return 0)
    it('status guard: lead con status non-READY_INVITE e non campagna → no-op (workerResult 0)', async () => {
        vi.mocked(getLeadByIdCore).mockResolvedValue(makeLead({ status: 'MESSAGED' }));

        const result = await processInviteJob(basePayload, makeContext());

        // Non deve transitionare, non deve sprecare azioni
        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'INVITED', expect.any(String), expect.anything());
    });

    // (4) verify pre/post: lead non trovato → throw RetryableWorkerError con code LEAD_NOT_FOUND
    it('lead non trovato → lancia RetryableWorkerError (code LEAD_NOT_FOUND)', async () => {
        vi.mocked(getLeadByIdCore).mockResolvedValue(null);

        const err = await processInviteJob(basePayload, makeContext()).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('LEAD_NOT_FOUND');
    });

    // (1) idempotency: URL già visitato oggi → early-return senza azione
    it('idempotency: URL già in visitedProfilesToday → skip (workerResult 0)', async () => {
        const visitedProfilesToday = new Set<string>(['https://www.linkedin.com/in/mario-rossi']);
        const ctx = makeContext({ visitedProfilesToday });

        const result = await processInviteJob(basePayload, ctx);

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'INVITED', expect.any(String), expect.anything());
    });

    // (2) budget gate: checkAndIncrementDailyLimit false → si ferma (dryRun=false per attivare il gate reale)
    it('budget gate: checkAndIncrementDailyLimit false → stop (processedCount 0)', async () => {
        vi.mocked(checkAndIncrementDailyLimit).mockResolvedValue(false);
        // Serve dryRun=false per attivare il gate; mocker page che non blocca prima
        const ctx = makeContext({ dryRun: false });

        const result = await processInviteJob(basePayload, ctx);

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'INVITED', expect.any(String), expect.anything());
    });

    // (3) state transition: dryRun=true → transitionLead chiamato con 'INVITED'
    it('state transition: successo → transitionLead chiamato con stato INVITED', async () => {
        // connectCount=1 → clickConnectOnProfile ritorna true
        // modalVisible=true → post-click modal check è visibile → handleInviteModal (dry run → ritorna subito)
        const page = makePage({ connectCount: 1, modalVisible: true });
        const ctx = makeContext({
            dryRun: true,
            session: { page } as unknown as WorkerContext['session'],
        });

        const result = await processInviteJob(basePayload, ctx);

        expect(result.processedCount).toBe(1);
        expect(vi.mocked(transitionLead)).toHaveBeenCalledWith(
            42,
            'INVITED',
            expect.any(String),
            expect.objectContaining({ dryRun: true }),
        );
    });

    // (4) linkedin_url mancante → REVIEW_REQUIRED
    it('linkedin_url vuota → transitionLead a REVIEW_REQUIRED (missing_linkedin_url)', async () => {
        vi.mocked(getLeadByIdCore).mockResolvedValue(makeLead({ linkedin_url: '' }));

        await processInviteJob(basePayload, makeContext());

        expect(vi.mocked(transitionLead)).toHaveBeenCalledWith(42, 'REVIEW_REQUIRED', 'missing_linkedin_url');
    });
});

// ─── messageWorker ────────────────────────────────────────────────────────────

describe('messageWorker — processMessageJob', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: lead READY_MESSAGE trovato
        vi.mocked(getLeadById).mockResolvedValue(makeLead({ status: 'READY_MESSAGE' }));
        vi.mocked(checkAndIncrementDailyLimit).mockResolvedValue(true);
        vi.mocked(getDailyStat).mockResolvedValue(0);
        vi.mocked(transitionLead).mockResolvedValue(undefined);
    });

    const basePayload: MessageJobPayload = { leadId: 42, acceptedAtDate: '2025-06-07' };

    // (4) verify pre/post: status guard — lead null o status sbagliato → no-op
    it('status guard: lead non trovato → no-op (workerResult 0)', async () => {
        vi.mocked(getLeadById).mockResolvedValue(null);

        const result = await processMessageJob(basePayload, makeContext());

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'MESSAGED', expect.any(String), expect.anything());
    });

    it('status guard: lead con status INVITED (non READY_MESSAGE) → no-op', async () => {
        vi.mocked(getLeadById).mockResolvedValue(makeLead({ status: 'INVITED' }));

        const result = await processMessageJob(basePayload, makeContext());

        expect(result.processedCount).toBe(0);
    });

    // (1) idempotency: se il lead non è READY_MESSAGE e non è campaign-driven → early return
    it('idempotency: seconda chiamata con lead già MESSAGED → no-op', async () => {
        vi.mocked(getLeadById).mockResolvedValue(makeLead({ status: 'MESSAGED' }));

        const result = await processMessageJob(basePayload, makeContext());

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'MESSAGED', expect.any(String), expect.anything());
    });

    // (2) budget gate: getDailyStat >= hardMsgCap → stop (pre-flight read-only check)
    it('budget gate pre-flight: getDailyStat >= hardMsgCap → stop', async () => {
        vi.mocked(getDailyStat).mockResolvedValue(20); // uguale al hardMsgCap=20
        const ctx = makeContext({ dryRun: false });

        const result = await processMessageJob(basePayload, ctx);

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'MESSAGED', expect.any(String), expect.anything());
    });

    // (2) budget gate: checkAndIncrementDailyLimit false → stop DOPO content verification
    // textboxValue deve contenere il messaggio per superare H11 e arrivare al cap check
    it('budget gate atomic: checkAndIncrementDailyLimit false → stop prima di invio', async () => {
        vi.mocked(checkAndIncrementDailyLimit).mockResolvedValue(false);
        const MESSAGE = 'Ciao! Volevo ringraziarti per aver accettato la mia connessione.';
        const page = makePage({ textboxValue: MESSAGE });
        const ctx = makeContext({
            dryRun: false,
            session: { page } as unknown as WorkerContext['session'],
        });

        const result = await processMessageJob(basePayload, ctx);

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'MESSAGED', expect.any(String), expect.anything());
    });

    // (3) state transition: successo dry-run → transitionLead con MESSAGED
    // dryRun=true salta il cap check atomico e il click Send reale
    it('state transition: successo → transitionLead con MESSAGED', async () => {
        const MESSAGE = 'Ciao! Volevo ringraziarti per aver accettato la mia connessione.';
        const page = makePage({ textboxValue: MESSAGE });
        const ctx = makeContext({
            dryRun: true,
            session: { page } as unknown as WorkerContext['session'],
        });

        const result = await processMessageJob(basePayload, ctx);

        expect(result.processedCount).toBe(1);
        expect(vi.mocked(transitionLead)).toHaveBeenCalledWith(
            42,
            'MESSAGED',
            expect.any(String),
            expect.anything(),
        );
    });

    // (4) linkedin_url mancante → REVIEW_REQUIRED
    it('linkedin_url vuota → transitionLead a REVIEW_REQUIRED', async () => {
        vi.mocked(getLeadById).mockResolvedValue(makeLead({ status: 'READY_MESSAGE', linkedin_url: '' }));

        await processMessageJob(basePayload, makeContext());

        expect(vi.mocked(transitionLead)).toHaveBeenCalledWith(42, 'REVIEW_REQUIRED', 'missing_linkedin_url');
    });
});

// ─── acceptanceWorker ─────────────────────────────────────────────────────────

describe('acceptanceWorker — processAcceptanceJob', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: lead INVITED trovato
        vi.mocked(getLeadById).mockResolvedValue(makeLead({ status: 'INVITED' }));
        vi.mocked(transitionLeadAtomic).mockResolvedValue(undefined);
    });

    const basePayload: AcceptanceJobPayload = { leadId: 42 };

    // (4) verify pre/post: status guard — lead null o status != INVITED → no-op
    it('status guard: lead non trovato → no-op (workerResult 0)', async () => {
        vi.mocked(getLeadById).mockResolvedValue(null);

        const result = await processAcceptanceJob(basePayload, makeContext({ dryRun: false }));

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLeadAtomic)).not.toHaveBeenCalled();
    });

    it('status guard: lead con status READY_INVITE (non INVITED) → no-op', async () => {
        vi.mocked(getLeadById).mockResolvedValue(makeLead({ status: 'READY_INVITE' }));

        const result = await processAcceptanceJob(basePayload, makeContext({ dryRun: false }));

        expect(result.processedCount).toBe(0);
    });

    // (1) idempotency: lead già in stato finale (non INVITED) → no-op
    it('idempotency: lead già ACCEPTED → no-op (no secondo cambio stato)', async () => {
        vi.mocked(getLeadById).mockResolvedValue(makeLead({ status: 'ACCEPTED' }));

        const result = await processAcceptanceJob(basePayload, makeContext({ dryRun: false }));

        expect(result.processedCount).toBe(0);
        expect(vi.mocked(transitionLeadAtomic)).not.toHaveBeenCalled();
    });

    // (3) state transition: acceptance rilevata → transitionLeadAtomic con ACCEPTED+READY_MESSAGE
    it('state transition: badge "1st" rilevato → transitionLeadAtomic con ACCEPTED e READY_MESSAGE', async () => {
        // distanceBadge='1st' → isFirstDegreeBadge ritorna true → accepted=true
        const page = makePage({ distanceBadge: '1st' });
        const ctx = makeContext({
            dryRun: false,
            session: { page } as unknown as WorkerContext['session'],
        });

        const result = await processAcceptanceJob(basePayload, ctx);

        expect(result.processedCount).toBe(1);
        expect(vi.mocked(transitionLeadAtomic)).toHaveBeenCalledWith(
            42,
            expect.arrayContaining([
                expect.objectContaining({ toStatus: 'ACCEPTED' }),
                expect.objectContaining({ toStatus: 'READY_MESSAGE' }),
            ]),
        );
    });

    // (4) SalesNav URL → REVIEW_REQUIRED (non passa oltre)
    it('SalesNav URL → transitionLead a REVIEW_REQUIRED (salesnav_url_needs_resolution)', async () => {
        const { isSalesNavigatorUrl } = await import('../linkedinUrl');
        vi.mocked(isSalesNavigatorUrl).mockReturnValue(true);

        await processAcceptanceJob(basePayload, makeContext({ dryRun: false }));

        expect(vi.mocked(transitionLead)).toHaveBeenCalledWith(42, 'REVIEW_REQUIRED', 'salesnav_url_needs_resolution');

        // Ripristina il mock
        vi.mocked(isSalesNavigatorUrl).mockReturnValue(false);
    });
});
