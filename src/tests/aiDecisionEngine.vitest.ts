import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageObservation } from '../browser/observePageContext';

const requestAiText = vi.fn();
const getDecisionAccuracy = vi.fn();
const recordDecision = vi.fn();

vi.mock('../ai/aiTextClient', () => ({
    requestAiText,
}));

vi.mock('../ai/decisionFeedback', () => ({
    getDecisionAccuracy,
    recordDecision,
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn(async () => undefined),
    logWarn: vi.fn(async () => undefined),
}));

import { config } from '../config';
import { aiDecide } from '../ai/aiDecisionEngine';

describe('aiDecisionEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        config.aiPersonalizationEnabled = false;
        getDecisionAccuracy.mockResolvedValue([]);
        recordDecision.mockResolvedValue(undefined);
    });

    it('strict con AI disabilitata resta compatibile e non blocca il worker', async () => {
        const decision = await aiDecide({ point: 'pre_invite', strict: true });
        expect(decision.action).toBe('PROCEED');
        expect(decision.reason).toContain('ai_not_configured');
    });

    it('strict con risposta non parsabile su punto critico fa DEFER', async () => {
        config.aiPersonalizationEnabled = true;
        requestAiText.mockResolvedValue('questa non è una risposta JSON');

        const decision = await aiDecide({ point: 'pre_message', strict: true });
        expect(decision.action).toBe('DEFER');
        expect(decision.reason).toContain('strict fallback');
    });

    it('strict con timeout su punto critico fa DEFER', async () => {
        vi.useFakeTimers();
        try {
            config.aiPersonalizationEnabled = true;
            requestAiText.mockImplementation(() => new Promise(() => undefined));

            const decisionPromise = aiDecide({ point: 'pre_invite', strict: true });
            await vi.advanceTimersByTimeAsync(8_100);

            const decision = await decisionPromise;
            expect(decision.action).toBe('DEFER');
            expect(decision.reason).toContain('timeout');
        } finally {
            vi.useRealTimers();
        }
    });

    it('strict su inbox_reply con risposta invalida fa NOTIFY_HUMAN', async () => {
        config.aiPersonalizationEnabled = true;
        requestAiText.mockResolvedValue('{ "action": "BOH", "reason": "x" }');

        const decision = await aiDecide({ point: 'inbox_reply', strict: true });
        expect(decision.action).toBe('NOTIFY_HUMAN');
        expect(decision.reason).toContain('invalid_action');
    });

    it('normalizza i nomi legacy della navigation strategy', async () => {
        config.aiPersonalizationEnabled = true;
        requestAiText.mockResolvedValue(
            '{ "action": "PROCEED", "confidence": 0.9, "reason": "ok", "navigationStrategy": "organic_search" }',
        );

        const decision = await aiDecide({ point: 'navigation', strict: true });
        expect(decision.action).toBe('PROCEED');
        expect(decision.navigationStrategy).toBe('search_organic');
    });

    it('in modalita permissiva un errore AI mantiene il fallback storico', async () => {
        config.aiPersonalizationEnabled = true;
        requestAiText.mockRejectedValue(new Error('boom'));

        const decision = await aiDecide({ point: 'pre_follow_up' });
        expect(decision.action).toBe('PROCEED');
        expect(decision.reason).toContain('ai_error');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F0.5 zero-PII: test SENTINELLA — il prompt non contiene MAI i dati identificativi
// del lead, per tutti e 5 i decision point. È la prova meccanica che autorizza
// la classificazione no-PII del purpose decision_engine nel providerRegistry.
// ═══════════════════════════════════════════════════════════════════════════════

describe('aiDecisionEngine — zero-PII nel prompt (sentinelle F0.5)', () => {
    const PII_LEAD = {
        id: 42,
        name: 'Mario Rossi',
        title: 'Chief Technology Officer',
        company: 'Acme S.p.A.',
        score: 87,
        about: 'Ho fondato la startup UnicornoViola nel 2019',
        email: 'mario.rossi@acme.com',
        businessEmail: 'm.rossi@acme-corp.it',
        phone: '+393331234567',
        location: 'Via Speciale 99, 12345 CittaSegretaXYZ',
        seniority: 'C-Suite Executive Leadership',
        industry: 'Information Technology & Services',
    };

    const PII_PAGE = {
        profileName: 'Mario Rossi',
        profileHeadline: 'CTO at Acme S.p.A. — turning coffee into code',
        connectionDegree: '2nd',
        hasConnectButton: true,
    } as unknown as PageObservation;

    const PII_CHAT = ['ME: ciao Mario, ti scrivo da Acme', 'THEM: il mio numero personale è +393331234567'];

    const SENTINELS = [
        'Mario',
        'Rossi',
        'Acme',
        'UnicornoViola',
        'mario.rossi@acme.com',
        'm.rossi@acme-corp.it',
        '+393331234567',
        'Via Speciale 99',
        'CittaSegretaXYZ',
        'Chief Technology Officer',
        'Information Technology & Services',
        'C-Suite Executive Leadership',
        'turning coffee into code',
        'numero personale',
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        config.aiPersonalizationEnabled = true;
        getDecisionAccuracy.mockResolvedValue([]);
        recordDecision.mockResolvedValue(undefined);
    });

    async function capturePrompt(request: Parameters<typeof aiDecide>[0]): Promise<string> {
        requestAiText.mockResolvedValue('{ "action": "PROCEED", "confidence": 0.9, "reason": "ok" }');
        await aiDecide(request);
        const call = requestAiText.mock.calls.at(-1)?.[0] as { system: string; user: string };
        expect(call).toBeDefined();
        return `${call.system}\n${call.user}`;
    }

    const SESSION = {
        invitesSent: 3,
        messagesSent: 1,
        riskScore: 20,
        pendingRatio: 0.3,
        duration: 12,
        challengeCount: 0,
    };

    it.each([
        ['pre_invite', { point: 'pre_invite', lead: PII_LEAD, pageObservation: PII_PAGE, session: SESSION }],
        ['pre_message', { point: 'pre_message', lead: PII_LEAD, chatMessages: PII_CHAT }],
        ['pre_follow_up', { point: 'pre_follow_up', lead: PII_LEAD, chatMessages: PII_CHAT }],
        ['inbox_reply', { point: 'inbox_reply', lead: PII_LEAD, chatMessages: PII_CHAT }],
        ['navigation', { point: 'navigation', lead: PII_LEAD, session: SESSION }],
    ] as const)('%s: nessuna sentinella PII nel prompt', async (_label, request) => {
        const prompt = await capturePrompt(request as Parameters<typeof aiDecide>[0]);
        for (const sentinel of SENTINELS) {
            expect(prompt).not.toContain(sentinel);
        }
    });

    it('pre_invite: il prompt contiene le feature anonime al posto dei dati grezzi', async () => {
        const prompt = await capturePrompt({
            point: 'pre_invite',
            lead: PII_LEAD,
            pageObservation: PII_PAGE,
            session: SESSION,
        });
        expect(prompt).toContain('segment=c_level');
        expect(prompt).toContain('industry=tech');
        expect(prompt).toContain('score=87/100');
        expect(prompt).toContain('Seniority: c_suite');
        expect(prompt).toContain('Connection: 2nd');
    });

    it('pre_message: la chat è distillata in segnali (mai testo)', async () => {
        const prompt = await capturePrompt({ point: 'pre_message', lead: PII_LEAD, chatMessages: PII_CHAT });
        expect(prompt).toContain('Conversation: 2 messages, last from lead, lead replied: yes');
    });

    it('pre_message senza chat (caso prod reale): nessuna riga Conversation', async () => {
        const prompt = await capturePrompt({ point: 'pre_message', lead: PII_LEAD });
        expect(prompt).not.toContain('Conversation:');
    });
});
