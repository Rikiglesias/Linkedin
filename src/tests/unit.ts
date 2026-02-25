import assert from 'assert';
import { isValidLeadTransition } from '../core/leadStateService';
import { calculateDynamicBudget, evaluateCooldownDecision, evaluateRisk } from '../risk/riskEngine';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { isProfileUrl, isSalesNavigatorUrl, normalizeLinkedInUrl } from '../linkedinUrl';
import { buildPersonalizedFollowUpMessage } from '../ai/messagePersonalizer';
import { buildPersonalizedInviteNote } from '../ai/inviteNotePersonalizer';
import { evaluateAiGuardian } from '../ai/guardian';
import { ScheduleResult } from '../core/scheduler';
import { LeadRecord } from '../types/domain';
import { getProxy, getProxyFailoverChain } from '../proxyManager';
import { generateInviteNote } from '../noteGenerator';

async function run(): Promise<void> {
    assert.equal(isValidLeadTransition('NEW', 'READY_INVITE'), true);
    assert.equal(isValidLeadTransition('READY_INVITE', 'INVITED'), true);
    assert.equal(isValidLeadTransition('INVITED', 'MESSAGED'), false);

    const risk = evaluateRisk({
        pendingRatio: 0.4,
        errorRate: 0.1,
        selectorFailureRate: 0.05,
        challengeCount: 0,
        inviteVelocityRatio: 0.3,
    });
    assert.equal(risk.action === 'NORMAL' || risk.action === 'WARN' || risk.action === 'STOP', true);

    const budgetNormal = calculateDynamicBudget(25, 35, 5, 'NORMAL');
    const budgetWarn = calculateDynamicBudget(25, 35, 5, 'WARN');
    assert.equal(budgetNormal > budgetWarn, true);

    const cooldownDecision = evaluateCooldownDecision({
        ...risk,
        action: 'WARN',
        score: 72,
        pendingRatio: 0.7,
    });
    assert.equal(cooldownDecision.activate, true);
    assert.equal(cooldownDecision.minutes > 0, true);

    const goodMessage = 'Ciao Mario, grazie per il collegamento.';
    const hash = hashMessage(goodMessage);
    assert.equal(hash.length, 64);
    const goodValidation = validateMessageContent(goodMessage, { duplicateCountLast24h: 0 });
    assert.equal(goodValidation.valid, true);

    const badValidation = validateMessageContent('Ciao {{firstName}}', { duplicateCountLast24h: 5 });
    assert.equal(badValidation.valid, false);

    assert.equal(isSalesNavigatorUrl('https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH/'), true);
    assert.equal(isProfileUrl('https://www.linkedin.com/in/mario-rossi-123/'), true);
    assert.equal(isProfileUrl('https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH/'), false);
    assert.equal(
        normalizeLinkedInUrl('https://it.linkedin.com/in/mario-rossi-123/detail/recent-activity/?trk=abc'),
        'https://www.linkedin.com/in/mario-rossi-123/'
    );

    const lead: LeadRecord = {
        id: 99,
        account_name: 'Demo Srl',
        first_name: 'Mario',
        last_name: 'Rossi',
        job_title: 'CEO',
        website: 'https://demo.example',
        linkedin_url: 'https://www.linkedin.com/in/mario-rossi-123/',
        status: 'READY_MESSAGE',
        list_name: 'default',
        invited_at: null,
        accepted_at: null,
        messaged_at: null,
        last_error: null,
        blocked_reason: null,
        created_at: '2026-02-25T00:00:00.000Z',
        updated_at: '2026-02-25T00:00:00.000Z',
    };
    const personalized = await buildPersonalizedFollowUpMessage(lead);
    assert.equal(personalized.message.length > 0, true);
    assert.equal(personalized.source === 'template' || personalized.source === 'ai', true);
    const personalizedInviteNote = await buildPersonalizedInviteNote(lead);
    assert.equal(personalizedInviteNote.note.length > 0, true);
    assert.equal(personalizedInviteNote.note.length <= 300, true);
    assert.equal(personalizedInviteNote.source === 'template' || personalizedInviteNote.source === 'ai', true);

    const schedule: ScheduleResult = {
        localDate: '2026-02-25',
        riskSnapshot: {
            score: 40,
            pendingRatio: 0.3,
            errorRate: 0.05,
            selectorFailureRate: 0.02,
            challengeCount: 0,
            inviteVelocityRatio: 0.2,
            action: 'NORMAL',
        },
        inviteBudget: 10,
        messageBudget: 10,
        queuedInviteJobs: 5,
        queuedCheckJobs: 4,
        queuedMessageJobs: 3,
        listBreakdown: [{
            listName: 'default',
            inviteBudget: 10,
            messageBudget: 10,
            queuedInviteJobs: 5,
            queuedCheckJobs: 4,
            queuedMessageJobs: 3,
            adaptiveFactor: 1,
            adaptiveReasons: [],
            pendingRatio: 0.3,
            blockedRatio: 0.1,
            maxScheduledDelaySec: 30,
        }],
        dryRun: false,
    };
    const guardian = await evaluateAiGuardian('all', schedule);
    assert.equal(guardian.decision !== null, true);

    // ── proxyManager ─────────────────────────────────────────────────────────
    // Senza PROXY_URL configurato, deve tornare undefined
    const proxy = getProxy();
    assert.equal(proxy === undefined || typeof proxy.server === 'string', true);
    const proxyChain = getProxyFailoverChain();
    assert.equal(Array.isArray(proxyChain), true);
    assert.equal(proxyChain.every((entry) => typeof entry.server === 'string'), true);

    // ── noteGenerator ────────────────────────────────────────────────────────
    const note1 = generateInviteNote('Mario');
    assert.equal(note1.length > 0, true);
    assert.equal(note1.includes('Mario'), true);
    assert.equal(note1.length <= 300, true);

    const note2 = generateInviteNote('');
    assert.equal(note2.length > 0, true); // fallback su 'collega'
}

run()
    .then(() => {
        console.log('Unit tests passed.');
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
