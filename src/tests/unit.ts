import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { AccountProfileConfig, config } from '../config';
import { isValidLeadTransition } from '../core/leadStateService';
import { calculateDynamicBudget, evaluateCooldownDecision, evaluateRisk } from '../risk/riskEngine';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { isProfileUrl, isSalesNavigatorUrl, normalizeLinkedInUrl } from '../linkedinUrl';
import { buildPersonalizedFollowUpMessage } from '../ai/messagePersonalizer';
import { buildPersonalizedInviteNote } from '../ai/inviteNotePersonalizer';
import { evaluateAiGuardian } from '../ai/guardian';
import { ScheduleResult, workflowToJobTypes } from '../core/scheduler';
import { LeadRecord } from '../types/domain';
import { getProxy, getProxyFailoverChain, getProxyPoolStatus, markProxyFailed, markProxyHealthy } from '../proxyManager';
import { getSchedulingAccountIds, pickAccountIdForLead } from '../accountManager';
import { generateInviteNote } from '../ai/inviteNotePersonalizer';
import { classifySiteMismatch, isMismatchAmbiguous } from '../core/audit';
import { SELECTORS } from '../selectors';

async function run(): Promise<void> {
    assert.equal(isValidLeadTransition('NEW', 'READY_INVITE'), true);
    assert.equal(isValidLeadTransition('READY_INVITE', 'INVITED'), true);
    assert.equal(isValidLeadTransition('INVITED', 'MESSAGED'), false);
    assert.equal(isValidLeadTransition('READY_MESSAGE', 'REVIEW_REQUIRED'), true);

    const ambiguousMismatch = classifySiteMismatch('READY_MESSAGE', {
        pendingInvite: false,
        connected: false,
        messageButton: false,
        canConnect: true,
    });
    assert.equal(ambiguousMismatch, 'ready_message_but_not_connected');
    assert.equal(ambiguousMismatch ? isMismatchAmbiguous(ambiguousMismatch) : false, true);

    const reconcilableMismatch = classifySiteMismatch('INVITED', {
        pendingInvite: false,
        connected: false,
        messageButton: false,
        canConnect: true,
    });
    assert.equal(reconcilableMismatch, 'invited_but_connect_available');
    assert.equal(reconcilableMismatch ? isMismatchAmbiguous(reconcilableMismatch) : true, false);
    assert.deepEqual(workflowToJobTypes('warmup'), []);
    assert.deepEqual(workflowToJobTypes('check'), ['ACCEPTANCE_CHECK', 'HYGIENE']);
    assert.deepEqual(workflowToJobTypes('invite'), ['INVITE']);

    const risk = evaluateRisk({
        pendingRatio: 0.4,
        errorRate: 0.1,
        selectorFailureRate: 0.05,
        challengeCount: 0,
        inviteVelocityRatio: 0.3,
    });
    assert.equal(risk.action === 'NORMAL' || risk.action === 'WARN' || risk.action === 'LOW_ACTIVITY' || risk.action === 'STOP', true);

    // test dynamic budget
    const budgetNormal = calculateDynamicBudget(25, 35, 5, 'NORMAL');
    const budgetWarn = calculateDynamicBudget(25, 35, 5, 'WARN');
    const budgetLowActivity = calculateDynamicBudget(25, 35, 5, 'LOW_ACTIVITY');
    assert.equal(budgetNormal, 20); // 25-5
    assert.equal(budgetWarn, 7);    // floor(25*0.5)-5 = floor(12.5)-5 = 12-5 = 7
    assert.equal(budgetLowActivity >= 0, true);

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
        about: null,
        experience: null,
        invite_prompt_variant: null,
        lead_score: null,
        confidence_score: null,
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

    // ── accountManager: round-robin uniforme/stabile ────────────────────────
    const originalMultiAccountEnabled = config.multiAccountEnabled;
    const originalAccountProfiles = config.accountProfiles.slice();
    const originalSessionDir = config.sessionDir;
    const mockedProfiles: AccountProfileConfig[] = [
        {
            id: 'main',
            sessionDir: path.resolve(process.cwd(), 'data', 'session_test_main'),
            proxyUrl: '',
            proxyUsername: '',
            proxyPassword: '',
            proxyType: 'unknown',
            warmupEnabled: false,
            warmupMaxDays: 30,
            warmupMinActions: 5,
        },
        {
            id: 'backup',
            sessionDir: path.resolve(process.cwd(), 'data', 'session_test_backup'),
            proxyUrl: '',
            proxyUsername: '',
            proxyPassword: '',
            proxyType: 'unknown',
            warmupEnabled: false,
            warmupMaxDays: 30,
            warmupMinActions: 5,
        },
    ];
    try {
        config.multiAccountEnabled = true;
        config.accountProfiles = mockedProfiles;
        config.sessionDir = path.resolve(process.cwd(), 'data', 'session_test_default');
        const schedulingAccounts = getSchedulingAccountIds();
        assert.deepEqual(schedulingAccounts, ['main', 'backup']);
        const assignmentCounts = new Map<string, number>();
        for (let leadId = 1; leadId <= 200; leadId++) {
            const assigned = pickAccountIdForLead(leadId);
            assert.equal(assigned, pickAccountIdForLead(leadId)); // mapping stabile per lead
            assignmentCounts.set(assigned, (assignmentCounts.get(assigned) ?? 0) + 1);
        }
        const mainCount = assignmentCounts.get('main') ?? 0;
        const backupCount = assignmentCounts.get('backup') ?? 0;
        assert.equal(Math.abs(mainCount - backupCount) <= 1, true);
    } finally {
        config.multiAccountEnabled = originalMultiAccountEnabled;
        config.accountProfiles = originalAccountProfiles;
        config.sessionDir = originalSessionDir;
    }

    // ── proxyManager: PROXY_LIST/PROXY_URL + cooldown failover ──────────────
    const originalProxyListPath = config.proxyListPath;
    const originalProxyUrl = config.proxyUrl;
    const originalProxyUsername = config.proxyUsername;
    const originalProxyPassword = config.proxyPassword;
    const proxyListPath = path.resolve(process.cwd(), 'data', 'test_proxy_list.txt');
    fs.writeFileSync(
        proxyListPath,
        [
            '# proxy pool test',
            '127.0.0.1:8080:userA:passA',
            'http://127.0.0.2:8081',
            'http://127.0.0.2:8081',
        ].join('\n'),
        'utf8'
    );
    try {
        config.proxyListPath = proxyListPath;
        config.proxyUrl = 'http://unused-fallback-proxy:9999';
        config.proxyUsername = '';
        config.proxyPassword = '';

        const poolFromList = getProxyPoolStatus();
        assert.equal(poolFromList.configured, true);
        assert.equal(poolFromList.total, 2);

        const chainFromList = getProxyFailoverChain();
        assert.equal(chainFromList.length, 2);
        const failedProxy = chainFromList[0];
        markProxyFailed(failedProxy);
        const poolAfterFailure = getProxyPoolStatus();
        assert.equal(poolAfterFailure.cooling >= 1, true);

        const chainAfterFailure = getProxyFailoverChain();
        if (chainAfterFailure.length > 1) {
            assert.equal(chainAfterFailure[0].server !== failedProxy.server, true);
        }
        markProxyHealthy(failedProxy);

        config.proxyListPath = '';
        config.proxyUrl = 'http://singleUser:singlePass@127.0.0.3:8082';
        const poolFromUrl = getProxyPoolStatus();
        assert.equal(poolFromUrl.configured, true);
        assert.equal(poolFromUrl.total, 1);

        const singleProxy = getProxy();
        assert.equal(singleProxy?.server, 'http://127.0.0.3:8082');
        assert.equal(singleProxy?.username, 'singleUser');
        assert.equal(singleProxy?.password, 'singlePass');
    } finally {
        config.proxyListPath = originalProxyListPath;
        config.proxyUrl = originalProxyUrl;
        config.proxyUsername = originalProxyUsername;
        config.proxyPassword = originalProxyPassword;
        if (fs.existsSync(proxyListPath)) {
            fs.unlinkSync(proxyListPath);
        }
    }

    // ── noteGenerator ────────────────────────────────────────────────────────
    const note1 = generateInviteNote('Mario');
    assert.equal(note1.note.length > 0, true);
    assert.equal(note1.note.includes('Mario'), true);
    assert.equal(note1.note.length <= 300, true);

    const note2 = generateInviteNote('');
    assert.equal(note2.note.length > 0, true); // fallback su 'collega'

    // ── selectors ────────────────────────────────────────────────────────────
    // SELECTORS è ora un array di priorità (readonly string[]).
    // Ogni chiave deve avere almeno 2 selettori per garantire fault-tolerance UI.
    for (const [key, value] of Object.entries(SELECTORS)) {
        if (Array.isArray(value)) {
            assert.equal(
                value.length >= 2,
                true,
                `Selector "${key}" ha meno di 2 alternative (${value.length}). Aggiungere almeno un fallback per fault-tolerance UI.`
            );
        }
    }
}

run()
    .then(() => {
        console.log('Unit tests passed.');
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
