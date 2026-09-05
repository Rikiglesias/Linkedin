/**
 * inviteProofRetryNoDuplicate.vitest.ts — C14 del contratto `bot-operativo`: un proof fallito non produce un secondo invito.
 *
 * Scenario: il click Connect è avvenuto, la prova di invio non è arrivata in tempo (`INVITE_NOT_CONFIRMED`,
 * `errors.ts` maxAttempts 2) e il job viene ritentato. Oggi il retry controllava solo il DB DOPO l'invio: se il lead
 * non era ancora INVITED, cliccava Connect una seconda volta. Ora, PRIMA di ogni click (e prima del cap che
 * incrementa `invites_sent`), il worker chiede all'helper di C13 se il profilo mostra già «Pending» nelle SUE azioni:
 * se sì → `transitionLead(INVITED, 'invite_already_pending')`, 0 click, `invites_sent` invariato.
 * L'helper è stubbato (la parte DOM è coperta su browser vero da `harnessInviteProofAnchored.ts`); il resto del worker
 * gira con lo stesso set di mock di `actionWorkers.vitest.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock globali PRIMA degli import dei moduli sotto test ───────────────────

const probe = vi.hoisted(() => ({
    pending: vi.fn(),
    weekly: vi.fn(),
    sent: vi.fn(),
    proof: vi.fn(),
}));

vi.mock('../browser/inviteStateProbe', () => ({
    hasPendingInviteIndicator: probe.pending,
    hasWeeklyInviteLimitNotice: probe.weekly,
    hasInviteSentNotice: probe.sent,
    detectInviteProofAnchored: probe.proof,
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn().mockResolvedValue(undefined),
    logWarn: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../core/repositories', () => ({
    checkAndIncrementDailyLimit: vi.fn().mockResolvedValue(true),
    countWeeklyInvites: vi.fn().mockResolvedValue(0),
    incrementDailyStat: vi.fn().mockResolvedValue(undefined),
    incrementListDailyStat: vi.fn().mockResolvedValue(undefined),
    recordLeadTimingAttribution: vi.fn().mockResolvedValue(undefined),
    updateLeadPromptVariant: vi.fn().mockResolvedValue(undefined),
    updateLeadScrapedContext: vi.fn().mockResolvedValue(undefined),
    getDailyStat: vi.fn().mockResolvedValue(0),
    getLeadById: vi.fn(),
    getLeadEnrichmentSummary: vi.fn().mockResolvedValue(null),
}));

vi.mock('../core/repositories/leadsCore', () => ({ getLeadById: vi.fn() }));
vi.mock('../core/repositories/blacklist', () => ({ isBlacklisted: vi.fn().mockResolvedValue(false) }));
vi.mock('../core/repositories/auditLog', () => ({ writeAuditEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../core/leadStateService', () => ({
    transitionLead: vi.fn().mockResolvedValue(undefined),
    transitionLeadAtomic: vi.fn().mockResolvedValue(undefined),
    isValidLeadTransition: vi.fn().mockReturnValue(true),
}));

vi.mock('../browser', () => ({
    clickLocatorHumanLike: vi.fn().mockResolvedValue(undefined),
    detectChallenge: vi.fn().mockResolvedValue(false),
    dismissKnownOverlays: vi.fn().mockResolvedValue(undefined),
    humanDelay: vi.fn().mockResolvedValue(undefined),
    humanType: vi.fn().mockResolvedValue(undefined),
    simulateHumanReading: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../browser/uiFallback', () => ({ clickWithFallback: vi.fn().mockResolvedValue(true) }));
vi.mock('../browser/human/humanTyping', () => ({ premiTastoSpeciale: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../browser/humanBehavior', () => ({
    ensureViewportDwell: vi.fn().mockResolvedValue(undefined),
    computeProfileDwellTime: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../browser/navigationContext', () => ({
    navigateToProfileWithContext: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../browser/auth', () => ({ isLoggedIn: vi.fn().mockResolvedValue(true) }));
vi.mock('../browser/observePageContext', () => ({
    observePageContext: vi.fn().mockResolvedValue({
        profileName: 'Mario Rossi',
        profileHeadline: 'CEO',
        connectionDegree: '2nd',
        isProfileDeleted: false,
        hasModalOpen: false,
        hasChallenge: false,
        currentUrl: 'https://www.linkedin.com/in/mario-rossi/',
        hasConnectButton: true,
        hasMessageButton: false,
        hasPendingIndicator: false,
    }),
    logObservation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../ai/aiDecisionEngine', () => ({
    aiDecide: vi.fn().mockResolvedValue({ action: 'PROCEED', confidence: 0.9, reason: 'test', suggestedDelaySec: 0 }),
}));
vi.mock('../ai/inviteNotePersonalizer', () => ({
    buildPersonalizedInviteNote: vi.fn().mockResolvedValue({ note: 'Ciao!', source: 'template', variant: 'TPL' }),
}));
vi.mock('../linkedinUrl', () => ({ isSalesNavigatorUrl: vi.fn().mockReturnValue(false) }));
vi.mock('../selectors', () => ({
    joinSelectors: vi.fn().mockImplementation((name: string) => `.sel-${name}`),
    SELECTORS: { connectButtonPrimary: ['.sel-connectButtonPrimary'] },
}));
vi.mock('../config', () => ({
    config: {
        hardInviteCap: 20,
        weeklyInviteLimit: 80,
        inviteWithNote: false,
        profileContextExtractionEnabled: false,
        aiPersonalizationEnabled: false,
    },
    getWeekStartDate: vi.fn(() => '2026-08-31'),
}));
vi.mock('../workers/sessionDataHelper', () => ({
    buildSessionSnapshot: vi.fn().mockResolvedValue({ sessionActionCount: 0 }),
}));
vi.mock('../risk/incidentManager', () => ({ pauseAutomation: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../cloud/cloudBridge', () => ({ bridgeDailyStat: vi.fn(), bridgeLeadStatus: vi.fn() }));
vi.mock('../ml/abBandit', () => ({
    recordSent: vi.fn().mockResolvedValue(undefined),
    inferHourBucket: vi.fn().mockReturnValue('morning'),
}));
vi.mock('../ml/segments', () => ({ inferLeadSegment: vi.fn().mockReturnValue('generic') }));
vi.mock('../utils/text', () => ({
    normalizeNameForComparison: vi.fn().mockImplementation((s: string) => s.toLowerCase().trim()),
    jaroWinklerSimilarity: vi.fn().mockReturnValue(0.95),
}));
vi.mock('../workers/challengeHandler', () => ({ attemptChallengeResolution: vi.fn().mockResolvedValue(true) }));

// ─── Import moduli sotto test (DOPO i mock) ──────────────────────────────────
import { clickLocatorHumanLike } from '../browser';
import { clickWithFallback } from '../browser/uiFallback';
import { checkAndIncrementDailyLimit, incrementDailyStat } from '../core/repositories';
import { getLeadById as getLeadByIdCore } from '../core/repositories/leadsCore';
import { transitionLead } from '../core/leadStateService';
import type { InviteJobPayload, LeadRecord } from '../types/domain';
import type { WorkerContext } from '../workers/context';
import { processInviteJob } from '../workers/inviteWorker';

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
    } as LeadRecord;
}

/** Pagina del profilo con Connect visibile: se il worker arrivasse al click, lo troverebbe. */
function makePage() {
    const locatorResult = (count: number, text: string, visible: boolean) => ({
        count: vi.fn().mockResolvedValue(count),
        first: () => ({
            count: vi.fn().mockResolvedValue(count),
            isVisible: vi.fn().mockResolvedValue(visible),
            isDisabled: vi.fn().mockResolvedValue(false),
            textContent: vi.fn().mockResolvedValue(text),
            innerText: vi.fn().mockResolvedValue(text),
            click: vi.fn().mockResolvedValue(undefined),
        }),
        isVisible: vi.fn().mockResolvedValue(visible),
        click: vi.fn().mockResolvedValue(undefined),
    });
    return {
        locator: vi.fn().mockImplementation((selector: string) => {
            if (selector === '.sel-connectButtonPrimary') return locatorResult(1, 'Connect', true);
            if (selector === 'h1') return locatorResult(1, 'Mario Rossi', true);
            return locatorResult(0, '', false);
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
        dryRun: false,
        localDate: '2026-09-05',
        accountId: 'default',
        visitedProfilesToday: new Set<string>(),
        sessionActionCount: 0,
        ...overrides,
    } as WorkerContext;
}

const payload: InviteJobPayload = { leadId: 42, localDate: '2026-09-05' };

describe('C14 — un proof fallito non produce un secondo invito', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getLeadByIdCore).mockResolvedValue(makeLead({ status: 'READY_INVITE' }));
        vi.mocked(checkAndIncrementDailyLimit).mockResolvedValue(true);
        probe.pending.mockResolvedValue(false);
        probe.weekly.mockResolvedValue(false);
        probe.sent.mockResolvedValue(false);
        probe.proof.mockResolvedValue(false);
    });

    it('profilo già Pending PRIMA del click → 0 click su Connect, lead INVITED (invite_already_pending), invites_sent invariato', async () => {
        probe.pending.mockResolvedValue(true);
        const ctx = makeContext();

        const result = await processInviteJob(payload, ctx);

        expect(result.processedCount).toBe(1);
        expect(probe.pending).toHaveBeenCalledTimes(1);
        expect(vi.mocked(clickWithFallback)).not.toHaveBeenCalled();
        expect(vi.mocked(clickLocatorHumanLike)).not.toHaveBeenCalled();
        expect(vi.mocked(checkAndIncrementDailyLimit)).not.toHaveBeenCalled();
        expect(vi.mocked(incrementDailyStat)).not.toHaveBeenCalledWith(expect.anything(), 'invites_sent', expect.anything());
        expect(vi.mocked(transitionLead)).toHaveBeenCalledWith(
            42,
            'INVITED',
            'invite_already_pending',
            expect.objectContaining({ dryRun: false }),
        );
    });

    it('profilo NON pending → il flusso prosegue e il cap viene consultato DOPO la sonda (ordine provato)', async () => {
        vi.mocked(checkAndIncrementDailyLimit).mockResolvedValue(false); // cap raggiunto → esce subito dopo
        const ctx = makeContext();

        const result = await processInviteJob(payload, ctx);

        expect(result.processedCount).toBe(0);
        expect(probe.pending).toHaveBeenCalledTimes(1);
        expect(vi.mocked(checkAndIncrementDailyLimit)).toHaveBeenCalledTimes(1);
        const sondaPrima = probe.pending.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
        const capDopo = vi.mocked(checkAndIncrementDailyLimit).mock.invocationCallOrder[0] ?? 0;
        expect(sondaPrima).toBeLessThan(capDopo);
        expect(vi.mocked(transitionLead)).not.toHaveBeenCalledWith(42, 'INVITED', expect.anything(), expect.anything());
    });

    it('dry-run: nessuna sonda sul DOM (non c’è un browser reale da interrogare)', async () => {
        const ctx = makeContext({ dryRun: true });
        // In dry-run il worker percorre comunque il flusso fino al click mockato: l'esito non conta qui,
        // conta che la sonda pre-click NON venga interrogata (il DOM non è quello di un browser vero).
        await processInviteJob(payload, ctx).catch(() => null);
        expect(probe.pending).not.toHaveBeenCalled();
    });

    it('sentinelle C13: nessuna lettura del body in inviteWorker e nella sonda; la sonda precede il cap', () => {
        const worker = readFileSync(path.resolve(__dirname, '..', 'workers', 'inviteWorker.ts'), 'utf8');
        expect(worker).not.toContain("textContent('body')");
        expect(worker).not.toContain('body.innerText');
        expect(worker).toContain('hasPendingInviteIndicator(');
        expect(worker).toContain('hasWeeklyInviteLimitNotice(');
        expect(worker).toContain('detectInviteProofAnchored(');
        const sonda = worker.indexOf('hasPendingInviteIndicator(context.session.page)');
        const cap = worker.indexOf("checkAndIncrementDailyLimit(context.localDate, 'invites_sent'");
        expect(sonda).toBeGreaterThan(0);
        expect(cap).toBeGreaterThan(sonda);

        const probeSource = readFileSync(path.resolve(__dirname, '..', 'browser', 'inviteStateProbe.ts'), 'utf8');
        expect(probeSource).not.toContain("textContent('body')");
        expect(probeSource).not.toContain('body.innerText');
        expect(probeSource).not.toContain("locator('body')");
    });
});
