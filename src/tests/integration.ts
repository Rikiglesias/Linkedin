import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';

async function run(): Promise<void> {
    const testDbPath = path.resolve(process.cwd(), 'data', 'test_integration.sqlite');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    process.env.DB_PATH = testDbPath;
    process.env.SUPABASE_SYNC_ENABLED = 'false';
    process.env.SELECTOR_CANARY_ENABLED = 'false';
    process.env.DASHBOARD_AUTH_ENABLED = 'true';
    process.env.DASHBOARD_API_KEY = 'integration-dashboard-key';
    process.env.DASHBOARD_BASIC_USER = '';
    process.env.DASHBOARD_BASIC_PASSWORD = '';
    process.env.DASHBOARD_TRUSTED_IPS = '';

    const dbModule = await import('../db');
    const repositories = await import('../core/repositories');
    const stateService = await import('../core/leadStateService');
    const serverModule = await import('../api/server');
    const configModule = await import('../config');
    const crmBridge = await import('../integrations/crmBridge');
    const leadEnricher = await import('../integrations/leadEnricher');
    const messagePersonalizer = await import('../ai/messagePersonalizer');
    const inviteNotePersonalizer = await import('../ai/inviteNotePersonalizer');
    const sentimentAnalysis = await import('../ai/sentimentAnalysis');
    const selectorLearner = await import('../selectors/learner');
    const secretRotationWorker = await import('../core/secretRotationWorker');
    const incidentManager = await import('../risk/incidentManager');
    const adminCommands = await import('../cli/commands/adminCommands');
    const timingOptimizer = await import('../ml/timingOptimizer');
    const restoreDbScript = await import('../scripts/restoreDb');
    const rampUpWorker = await import('../workers/rampUpWorker');

    let httpServer: ReturnType<typeof serverModule.startServer> | null = null;
    const rotationEnvPath = path.resolve(process.cwd(), 'data', 'test_secret_rotation.env');
    const featureStoreExportDir = path.resolve(process.cwd(), 'data', 'test_feature_store');
    const restoreDrillReportDir = path.resolve(process.cwd(), 'data', 'test_restore_drill');

    try {
        await dbModule.initDatabase();

        const originalHubspotApiKey = configModule.config.hubspotApiKey;
        const originalHunterApiKey = configModule.config.hunterApiKey;
        const originalClearbitApiKey = configModule.config.clearbitApiKey;
        const originalOpenAiBaseUrl = configModule.config.openaiBaseUrl;
        const originalOpenAiApiKey = configModule.config.openaiApiKey;
        const originalAiPersonalizationEnabled = configModule.config.aiPersonalizationEnabled;
        const originalAiSentimentEnabled = configModule.config.aiSentimentEnabled;
        const originalInviteNoteMode = configModule.config.inviteNoteMode;
        const originalFetch = globalThis.fetch;

        try {
            configModule.config.hubspotApiKey = 'integration-hubspot-key';
            configModule.config.hunterApiKey = 'integration-hunter-key';
            configModule.config.clearbitApiKey = '';
            configModule.config.openaiBaseUrl = 'http://127.0.0.1:11434/v1';
            configModule.config.openaiApiKey = '';
            configModule.config.aiPersonalizationEnabled = true;
            configModule.config.aiSentimentEnabled = true;
            configModule.config.inviteNoteMode = 'ai';

            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const rawUrl = typeof input === 'string'
                    ? input
                    : (input instanceof URL ? input.toString() : input.url);
                const method = (init?.method ?? 'GET').toUpperCase();

                if (rawUrl.includes('api.hubapi.com/crm/v3/objects/contacts') && method === 'GET') {
                    return new Response(JSON.stringify({
                        results: [{
                            properties: {
                                linkedin_url: 'https://www.linkedin.com/in/hubspot-ada-lovelace/',
                                firstname: 'Ada',
                                lastname: 'Lovelace',
                                company: 'Analytical Engine',
                            },
                        }],
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                if (rawUrl.includes('api.hunter.io/v2/email-finder') && method === 'GET') {
                    return new Response(JSON.stringify({
                        data: {
                            email: 'ada@analyticalengine.com',
                            confidence: 93,
                            position: 'Mathematician',
                        },
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                if (rawUrl.includes('/chat/completions') && method === 'POST') {
                    const rawBody = typeof init?.body === 'string' ? init.body : '';
                    const requestBody = rawBody ? JSON.parse(rawBody) as { messages?: Array<{ role?: string; content?: string }> } : {};
                    const systemContent = (requestBody.messages ?? []).find((message) => message.role === 'system')?.content ?? '';
                    const userContent = (requestBody.messages ?? []).find((message) => message.role === 'user')?.content ?? '';
                    const isSentimentPrompt = userContent.includes('Analizza questo messaggio');
                    const isInvitePrompt = /inviti linkedin/i.test(systemContent);
                    const content = isSentimentPrompt
                        ? JSON.stringify({
                            intent: 'POSITIVE',
                            subIntent: 'CALL_REQUESTED',
                            entities: ['call'],
                            confidence: 0.91,
                            reasoning: 'Richiesta esplicita di contatto.',
                        })
                        : (isInvitePrompt
                            ? 'Ciao Ada, ho letto il tuo percorso e mi piacerebbe scambiarci due idee sul networking B2B.'
                            : 'Ciao Ada, grazie per il collegamento. Se vuoi ci sentiamo 10 minuti questa settimana.');

                    return new Response(JSON.stringify({
                        choices: [{ message: { content } }],
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                return new Response(JSON.stringify({ error: 'not mocked' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                });
            }) as typeof fetch;

            const importedHubspotFirst = await crmBridge.pullFromHubSpot();
            assert.equal(importedHubspotFirst, 1);

            const importedHubspotSecond = await crmBridge.pullFromHubSpot();
            assert.equal(importedHubspotSecond, 0);

            const hubspotLead = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/hubspot-ada-lovelace/');
            assert.ok(hubspotLead);
            assert.equal(hubspotLead?.first_name, 'Ada');
            assert.equal(hubspotLead?.last_name, 'Lovelace');
            assert.equal(hubspotLead?.account_name, 'Analytical Engine');
            assert.equal(hubspotLead?.list_name, 'hubspot');
            assert.equal(hubspotLead?.status, 'READY_INVITE');

            const enrichment = await leadEnricher.enrichLeadAuto({
                id: 1,
                first_name: 'Ada',
                last_name: 'Lovelace',
                website: 'https://analyticalengine.com',
                account_name: 'Analytical Engine',
            });
            assert.equal(enrichment.email, 'ada@analyticalengine.com');
            assert.equal(enrichment.source, 'hunter');

            const enrichmentMissingData = await leadEnricher.enrichLeadAuto({
                id: 2,
                first_name: '',
                last_name: 'Unknown',
                website: '',
                account_name: '',
            });
            assert.equal(enrichmentMissingData.source, 'none');
            assert.equal(enrichmentMissingData.email, null);

            if (!hubspotLead) {
                throw new Error('Lead HubSpot non trovato per test AI');
            }

            const personalizedFollowUp = await messagePersonalizer.buildPersonalizedFollowUpMessage(hubspotLead);
            assert.equal(personalizedFollowUp.source, 'ai');
            assert.equal(personalizedFollowUp.model, configModule.config.aiModel);

            const personalizedInvite = await inviteNotePersonalizer.buildPersonalizedInviteNote(hubspotLead);
            assert.equal(personalizedInvite.source === 'ai' || personalizedInvite.source === 'template', true);
            if (personalizedInvite.source === 'ai') {
                assert.equal(personalizedInvite.model, configModule.config.aiModel);
            } else {
                assert.equal(personalizedInvite.model, null);
            }

            const sentiment = await sentimentAnalysis.analyzeIncomingMessage('Ciao, mi interessa e possiamo fissare una call?');
            assert.equal(sentiment.intent, 'POSITIVE');
            assert.equal(sentiment.subIntent, 'CALL_REQUESTED');

            configModule.config.aiSentimentEnabled = false;
            const sentimentDisabled = await sentimentAnalysis.analyzeIncomingMessage('messaggio qualunque');
            assert.equal(sentimentDisabled.intent, 'UNKNOWN');
        } finally {
            globalThis.fetch = originalFetch;
            configModule.config.hubspotApiKey = originalHubspotApiKey;
            configModule.config.hunterApiKey = originalHunterApiKey;
            configModule.config.clearbitApiKey = originalClearbitApiKey;
            configModule.config.openaiBaseUrl = originalOpenAiBaseUrl;
            configModule.config.openaiApiKey = originalOpenAiApiKey;
            configModule.config.aiPersonalizationEnabled = originalAiPersonalizationEnabled;
            configModule.config.aiSentimentEnabled = originalAiSentimentEnabled;
            configModule.config.inviteNoteMode = originalInviteNoteMode;
        }

    fs.writeFileSync(rotationEnvPath, 'DASHBOARD_API_KEY=rotation_test_seed\n', 'utf8');
    process.env.DASHBOARD_API_KEY = 'rotation_test_seed';
    const seedRotation = await secretRotationWorker.runSecretRotationWorker({
        apply: false,
        intervalDays: 7,
        actor: 'integration-test',
        envFilePath: rotationEnvPath,
        includeSecrets: ['DASHBOARD_API_KEY'],
    });
    assert.equal(seedRotation.seeded >= 1, true);

    await repositories.upsertSecretRotation(
        'DASHBOARD_API_KEY',
        new Date(Date.now() - (3 * 86_400_000)).toISOString(),
        'dashboard',
        null,
        'forced_old_for_integration'
    );

    const appliedRotation = await secretRotationWorker.runSecretRotationWorker({
        apply: true,
        intervalDays: 1,
        actor: 'integration-test',
        envFilePath: rotationEnvPath,
        includeSecrets: ['DASHBOARD_API_KEY'],
    });
    assert.equal(appliedRotation.rotated >= 1, true);
    const envAfterRotation = fs.readFileSync(rotationEnvPath, 'utf8');
    assert.equal(envAfterRotation.includes('DASHBOARD_API_KEY=rotation_test_seed'), false);

    const inserted = await repositories.addLead({
        accountName: 'Rossi Srl',
        firstName: 'Mario',
        lastName: 'Rossi',
        jobTitle: 'CEO',
        website: 'https://example.com',
        linkedinUrl: 'https://www.linkedin.com/in/mario-rossi-test/',
        listName: 'test-list',
    });
    assert.equal(inserted, true);
    const commentReviewLead = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/mario-rossi-test/');
    assert.ok(commentReviewLead);
    if (!commentReviewLead) {
        throw new Error('Lead per comment suggestions non trovato');
    }
    const dbForCommentSuggestions = await dbModule.getDatabase();
    const commentMetadata = {
        recent_posts: [
            {
                text: 'Abbiamo lanciato una nuova iniziativa su automazione commerciale B2B.',
            },
            {
                text: 'Cerco confronto su KPI di conversione tra outreach manuale e assistito.',
            },
        ],
        comment_suggestions: [
            {
                postIndex: 0,
                comment: 'Complimenti per il lancio. Quale KPI state monitorando nelle prime due settimane?',
                confidence: 0.91,
                source: 'ollama',
                model: 'llama3.1:8b',
                status: 'REVIEW_PENDING',
                generatedAt: '2026-03-01T10:00:00.000Z',
            },
            {
                postIndex: 1,
                comment: 'Tema interessante: avete segmentato i risultati per industry o seniority del target?',
                confidence: 0.84,
                source: 'ollama',
                model: 'llama3.1:8b',
                status: 'REVIEW_PENDING',
                generatedAt: '2026-03-01T10:05:00.000Z',
            },
        ],
        comment_suggestions_review_required: true,
    };
    try {
        await dbForCommentSuggestions.run(
            `UPDATE leads
                SET metadata_json = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [JSON.stringify(commentMetadata), commentReviewLead.id]
        );
    } catch {
        await dbForCommentSuggestions.run(
            `UPDATE leads
                SET lead_metadata = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [JSON.stringify(commentMetadata), commentReviewLead.id]
        );
    }

    const syncedLeadInsert = await repositories.upsertSalesNavigatorLead({
        accountName: 'Sales Co',
        firstName: 'Luca',
        lastName: 'Verdi',
        jobTitle: 'Head of Sales',
        website: '',
        linkedinUrl: 'https://www.linkedin.com/in/luca-verdi-sync-test/',
        listName: 'sales-list',
    });
    assert.equal(syncedLeadInsert.action, 'inserted');

    const syncedLeadUpdate = await repositories.upsertSalesNavigatorLead({
        accountName: 'Sales Company Spa',
        firstName: 'Luca',
        lastName: 'Verdi',
        jobTitle: 'VP Sales',
        website: '',
        linkedinUrl: 'https://www.linkedin.com/in/luca-verdi-sync-test/',
        listName: 'sales-list-updated',
    });
    assert.equal(syncedLeadUpdate.action === 'updated' || syncedLeadUpdate.action === 'unchanged', true);

    const syncedLead = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/luca-verdi-sync-test/');
    assert.ok(syncedLead);
    if (!syncedLead) {
        throw new Error('Lead sincronizzato non trovato');
    }
    assert.equal(syncedLead.list_name, 'sales-list-updated');

    const salesNavList = await repositories.upsertSalesNavList(
        'sales-list-updated',
        'https://www.linkedin.com/sales/lists/people/123456789/'
    );
    await repositories.linkLeadToSalesNavList(salesNavList.id, syncedLead.id);
    const salesNavLists = await repositories.listSalesNavLists(10);
    const linkedSalesList = salesNavLists.find((item) => item.id === salesNavList.id);
    assert.ok(linkedSalesList);
    assert.equal((linkedSalesList?.leads_count ?? 0) >= 1, true);

    const cpApplyCreate = await repositories.applyControlPlaneCampaignConfigs([
        {
            name: 'cp-alpha',
            isActive: true,
            priority: 5,
            dailyInviteCap: 12,
            dailyMessageCap: 18,
        },
        {
            name: 'cp-paused',
            isActive: false,
            priority: 80,
            dailyInviteCap: null,
            dailyMessageCap: null,
        },
    ]);
    assert.equal(cpApplyCreate.fetched, 2);
    assert.equal(cpApplyCreate.created, 2);
    assert.equal(cpApplyCreate.updated, 0);

    const cpApplyUpdate = await repositories.applyControlPlaneCampaignConfigs([
        {
            name: 'cp-alpha',
            isActive: true,
            priority: 2,
            dailyInviteCap: 10,
            dailyMessageCap: 14,
        },
        {
            name: 'cp-paused',
            isActive: false,
            priority: 80,
            dailyInviteCap: null,
            dailyMessageCap: null,
        },
    ]);
    assert.equal(cpApplyUpdate.fetched, 2);
    assert.equal(cpApplyUpdate.updated, 1);
    assert.equal(cpApplyUpdate.unchanged, 1);

    const listsAfterControlPlane = await repositories.listLeadCampaignConfigs(false);
    const cpAlpha = listsAfterControlPlane.find((item) => item.name === 'cp-alpha');
    const cpPaused = listsAfterControlPlane.find((item) => item.name === 'cp-paused');
    assert.ok(cpAlpha);
    assert.ok(cpPaused);
    assert.equal(cpAlpha?.source, 'control_plane');
    assert.equal(cpAlpha?.priority, 2);
    assert.equal(cpAlpha?.dailyInviteCap, 10);
    assert.equal(cpAlpha?.dailyMessageCap, 14);
    assert.equal(cpPaused?.source, 'control_plane');
    assert.equal(cpPaused?.isActive, false);

    await repositories.promoteNewLeadsToReadyInvite(10);
    const ready = await repositories.getLeadsByStatus('READY_INVITE', 10);
    assert.equal(ready.length >= 1, true);

    const lead = ready.find((row) => row.linkedin_url.includes('/in/mario-rossi-test/')) ?? ready[0];
    await stateService.transitionLead(lead.id, 'INVITED', 'integration_invite');
    const invited = await repositories.getLeadsByStatus('INVITED', 10);
    assert.equal(invited.length, 1);

    await stateService.reconcileLeadStatus(lead.id, 'READY_INVITE', 'integration_reconcile_back');
    const readyAgain = await repositories.getLeadsByStatus('READY_INVITE', 10);
    assert.equal(readyAgain.some((row) => row.id === lead.id), true);
    await stateService.transitionLead(lead.id, 'INVITED', 'integration_invite_again');

    const queued = await repositories.enqueueJob(
        'INVITE',
        { leadId: lead.id, localDate: '2026-02-24' },
        `invite:${lead.id}:2026-02-24`,
        10,
        3
    );
    assert.equal(queued, true);

    const locked = await repositories.lockNextQueuedJob(['INVITE']);
    assert.ok(locked);
    if (!locked) {
        throw new Error('Lock job fallito');
    }
    await repositories.markJobSucceeded(locked.id);

    const dailyInvites = await repositories.getDailyStat('2026-02-24', 'invites_sent');
    assert.equal(dailyInvites, 0);

    const lockA = await repositories.acquireRuntimeLock('integration.runner.lock', 'owner-a', 5, { source: 'integration' });
    assert.equal(lockA.acquired, true);

    const lockBBlocked = await repositories.acquireRuntimeLock('integration.runner.lock', 'owner-b', 5, { source: 'integration' });
    assert.equal(lockBBlocked.acquired, false);
    assert.equal(lockBBlocked.lock?.owner_id, 'owner-a');

    const heartbeatOk = await repositories.heartbeatRuntimeLock('integration.runner.lock', 'owner-a', 5);
    assert.equal(heartbeatOk, true);

    const releasedByWrongOwner = await repositories.releaseRuntimeLock('integration.runner.lock', 'owner-b');
    assert.equal(releasedByWrongOwner, false);

    const releasedByOwner = await repositories.releaseRuntimeLock('integration.runner.lock', 'owner-a');
    assert.equal(releasedByOwner, true);

    const staleLock = await repositories.acquireRuntimeLock('integration.stale.lock', 'owner-a', 1, { source: 'integration' });
    assert.equal(staleLock.acquired, true);
    await new Promise((resolve) => setTimeout(resolve, 2100));

    const staleTakeover = await repositories.acquireRuntimeLock('integration.stale.lock', 'owner-b', 5, { source: 'integration' });
    assert.equal(staleTakeover.acquired, true);
    assert.equal(staleTakeover.lock?.owner_id, 'owner-b');

    const raceAcquireA = await repositories.acquireRuntimeLock('integration.race.lock', 'owner-race-a', 5, { source: 'integration' });
    assert.equal(raceAcquireA.acquired, true);
    const raceAcquireB = await repositories.acquireRuntimeLock('integration.race.lock', 'owner-race-b', 5, { source: 'integration' });
    assert.equal(raceAcquireB.acquired, false);
    await repositories.releaseRuntimeLock('integration.race.lock', 'owner-race-a');

    const lockSummary = await repositories.getLockContentionSummary(configModule.getLocalDateString());
    assert.equal(lockSummary.acquireContended >= 1, true);
    assert.equal(lockSummary.acquireStaleTakeover >= 1, true);
    assert.equal(lockSummary.releaseMiss >= 1, true);

    // Outbox idempotency end-to-end: dedup enqueue + lease claim + owner-bound ack/retry.
    await repositories.pushOutboxEvent(
        'integration.outbox.idempotency',
        { scope: 'integration', step: 1 },
        'integration.outbox.idempotency:key-1'
    );
    await repositories.pushOutboxEvent(
        'integration.outbox.idempotency',
        { scope: 'integration', step: 2 },
        'integration.outbox.idempotency:key-1'
    );

    const db = await dbModule.getDatabase();
    const outboxRow = await db.get<{ id: number; total: number }>(
        `
        SELECT MIN(id) AS id, COUNT(*) AS total
        FROM outbox_events
        WHERE idempotency_key = ?
    `,
        ['integration.outbox.idempotency:key-1']
    );
    assert.equal(outboxRow?.total, 1);
    const outboxEventId = outboxRow?.id ?? 0;
    assert.equal(outboxEventId > 0, true);

    const ownerA = 'integration-owner-a';
    const ownerB = 'integration-owner-b';
    const claimedByA = await repositories.claimPendingOutboxEvents(250, ownerA, 45);
    assert.equal(claimedByA.some((row) => row.id === outboxEventId), true);

    const claimedByB = await repositories.claimPendingOutboxEvents(250, ownerB, 45);
    assert.equal(claimedByB.some((row) => row.id === outboxEventId), false);

    const deliveredWrongOwner = await repositories.markOutboxDeliveredClaimed(outboxEventId, ownerB);
    assert.equal(deliveredWrongOwner, false);

    const deliveredRightOwner = await repositories.markOutboxDeliveredClaimed(outboxEventId, ownerA);
    assert.equal(deliveredRightOwner, true);

    const deliveredDuplicateAck = await repositories.markOutboxDeliveredClaimed(outboxEventId, ownerA);
    assert.equal(deliveredDuplicateAck, false);

    await repositories.recordSelectorFailure(
        'integration.selector.action',
        'https://www.linkedin.com/in/diagnostics-test/',
        ['button[aria-label="Connect"]', '[data-test="connect-button"]'],
        'selector not found during diagnostics test'
    );

    const originalConsoleLog = console.log;
    const diagnosticsLogs: string[] = [];
    console.log = (...parts: unknown[]) => {
        diagnosticsLogs.push(parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    };
    try {
        await adminCommands.runDiagnosticsCommand([
            '--sections',
            'health,locks,queue,sync,selectors',
            '--lock-metrics-limit',
            '5',
            '--selector-limit',
            '5',
        ]);
    } finally {
        console.log = originalConsoleLog;
    }
    assert.equal(diagnosticsLogs.length >= 1, true);
    const diagnosticsPayload = JSON.parse(diagnosticsLogs[diagnosticsLogs.length - 1] ?? '{}') as {
        sections?: string[];
        health?: {
            compliance?: { score?: number };
            slo?: { status?: string; windows?: Array<{ windowDays?: number }> } | null;
        };
        locks?: { runnerLockKey?: string };
        queue?: { queueLagSeconds?: number };
        sync?: {
            activeSink?: string;
            supabase?: { backpressureLevel?: number; effectiveBatchSize?: number };
            webhook?: { backpressureLevel?: number; effectiveBatchSize?: number };
        };
        selectors?: { openFailures?: Array<{ actionLabel?: string }> };
    };
    assert.equal(Array.isArray(diagnosticsPayload.sections), true);
    assert.equal(typeof diagnosticsPayload.health?.compliance?.score, 'number');
    assert.equal(
        diagnosticsPayload.health?.slo?.status === 'OK'
        || diagnosticsPayload.health?.slo?.status === 'WARN'
        || diagnosticsPayload.health?.slo?.status === 'CRITICAL'
        || diagnosticsPayload.health?.slo === null,
        true
    );
    assert.equal(diagnosticsPayload.locks?.runnerLockKey, 'workflow.runner');
    assert.equal(typeof diagnosticsPayload.queue?.queueLagSeconds, 'number');
    assert.equal(typeof diagnosticsPayload.sync?.activeSink, 'string');
    assert.equal(typeof diagnosticsPayload.sync?.supabase?.backpressureLevel, 'number');
    assert.equal(typeof diagnosticsPayload.sync?.supabase?.effectiveBatchSize, 'number');
    assert.equal(typeof diagnosticsPayload.sync?.webhook?.backpressureLevel, 'number');
    assert.equal(typeof diagnosticsPayload.sync?.webhook?.effectiveBatchSize, 'number');
    assert.equal(
        diagnosticsPayload.selectors?.openFailures?.some((row) => row.actionLabel === 'integration.selector.action'),
        true
    );

    const securityAdvisorLogs: string[] = [];
    console.log = (...parts: unknown[]) => {
        securityAdvisorLogs.push(parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    };
    try {
        await adminCommands.runSecurityAdvisorCommand(['--by', 'integration-test']);
    } finally {
        console.log = originalConsoleLog;
    }
    assert.equal(securityAdvisorLogs.length >= 1, true);
    const securityAdvisorPayload = JSON.parse(securityAdvisorLogs[securityAdvisorLogs.length - 1] ?? '{}') as {
        status?: string;
        summary?: { totalChecks?: number };
        backlog?: unknown[];
    };
    assert.equal(
        securityAdvisorPayload.status === 'OK'
        || securityAdvisorPayload.status === 'WARN'
        || securityAdvisorPayload.status === 'FAILED'
        || securityAdvisorPayload.status === 'SKIPPED',
        true
    );
    assert.equal(typeof securityAdvisorPayload.summary?.totalChecks, 'number');
    assert.equal(Array.isArray(securityAdvisorPayload.backlog), true);

    const statusLogs: string[] = [];
    console.log = (...parts: unknown[]) => {
        statusLogs.push(parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    };
    try {
        await adminCommands.runStatusCommand();
    } finally {
        console.log = originalConsoleLog;
    }
    assert.equal(statusLogs.length >= 1, true);
    const statusPayload = JSON.parse(statusLogs[statusLogs.length - 1] ?? '{}') as {
        securityAdvisor?: {
            enabled?: boolean;
            intervalDays?: number;
            stale?: boolean;
            lastStatus?: string | null;
        };
    };
    assert.equal(typeof statusPayload.securityAdvisor?.enabled, 'boolean');
    assert.equal(typeof statusPayload.securityAdvisor?.intervalDays, 'number');
    assert.equal(typeof statusPayload.securityAdvisor?.stale, 'boolean');
    assert.equal(
        typeof statusPayload.securityAdvisor?.lastStatus === 'string'
        || statusPayload.securityAdvisor?.lastStatus === null,
        true
    );

    const delayedQueued = await repositories.enqueueJob(
        'INVITE',
        { leadId: lead.id, localDate: '2026-02-24' },
        `invite:${lead.id}:delayed`,
        10,
        3,
        60
    );
    assert.equal(delayedQueued, true);
    const delayedLocked = await repositories.lockNextQueuedJob(['INVITE']);
    assert.equal(delayedLocked, null);

    const accountQueuedA = await repositories.enqueueJob(
        'INVITE',
        { leadId: lead.id, localDate: '2026-02-25' },
        `invite:${lead.id}:account-a`,
        10,
        3,
        0,
        'acc-a'
    );
    assert.equal(accountQueuedA, true);

    const accountQueuedB = await repositories.enqueueJob(
        'MESSAGE',
        { leadId: lead.id, acceptedAtDate: '2026-02-25' },
        `message:${lead.id}:account-b`,
        10,
        3,
        0,
        'acc-b'
    );
    assert.equal(accountQueuedB, true);

    const lockedAccA = await repositories.lockNextQueuedJob(['INVITE', 'MESSAGE'], 'acc-a');
    assert.ok(lockedAccA);
    if (!lockedAccA) {
        throw new Error('Lock job acc-a fallito');
    }
    assert.equal(lockedAccA.account_id, 'acc-a');
    await repositories.markJobSucceeded(lockedAccA.id);

    const lockedAccB = await repositories.lockNextQueuedJob(['INVITE', 'MESSAGE'], 'acc-b');
    assert.ok(lockedAccB);
    if (!lockedAccB) {
        throw new Error('Lock job acc-b fallito');
    }
    assert.equal(lockedAccB.account_id, 'acc-b');
    await repositories.markJobSucceeded(lockedAccB.id);

    await incidentManager.pauseAutomation('INTEGRATION_TEST_PAUSE', { accountId: 'default' }, 5);
    const pauseStateAfterPause = await repositories.getAutomationPauseState();
    assert.equal(pauseStateAfterPause.paused, true);
    await incidentManager.resumeAutomation();
    const pauseStateAfterResume = await repositories.getAutomationPauseState();
    assert.equal(pauseStateAfterResume.paused, false);

    await incidentManager.setQuarantine(true);
    const quarantineOn = await repositories.getRuntimeFlag('account_quarantine');
    assert.equal(quarantineOn, 'true');
    await incidentManager.setQuarantine(false);
    const quarantineOff = await repositories.getRuntimeFlag('account_quarantine');
    assert.equal(quarantineOff, 'false');

    await stateService.transitionLead(lead.id, 'REVIEW_REQUIRED', 'integration_review_queue', {
        mismatch: 'ready_message_but_not_connected',
        evidencePath: 'data/review/integration-evidence.png',
        siteSignals: {
            pendingInvite: false,
            connected: false,
            messageButton: false,
            canConnect: true,
        },
    });
    const reviewQueue = await repositories.listReviewQueue(10);
    const reviewEntry = reviewQueue.find((row) => row.leadId === lead.id);
    assert.ok(reviewEntry);
    assert.equal(reviewEntry?.reviewReason, 'integration_review_queue');
    assert.equal(reviewEntry?.evidencePath, 'data/review/integration-evidence.png');

    const timingInviteBaselineAccepted = await repositories.addLead({
        accountName: 'Timing Invite Baseline Accepted',
        firstName: 'Anna',
        lastName: 'Baseline',
        jobTitle: 'CEO',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-invite-baseline-accepted/',
        listName: 'timing-test',
    });
    assert.equal(timingInviteBaselineAccepted, true);
    const leadInviteBaselineAccepted = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-invite-baseline-accepted/');
    assert.ok(leadInviteBaselineAccepted);
    if (!leadInviteBaselineAccepted) {
        throw new Error('Lead timing invite baseline accepted non trovato');
    }
    await repositories.setLeadStatus(leadInviteBaselineAccepted.id, 'READY_INVITE');
    await stateService.transitionLead(leadInviteBaselineAccepted.id, 'INVITED', 'integration_timing_invite_baseline_sent');
    await repositories.recordLeadTimingAttribution(leadInviteBaselineAccepted.id, 'invite', {
        strategy: 'baseline',
        segment: 'executive',
        score: 0.32,
        slotHour: 10,
        slotDow: 2,
        delaySec: 0,
        model: 'timing_optimizer_v2',
    });
    await stateService.transitionLead(leadInviteBaselineAccepted.id, 'ACCEPTED', 'integration_timing_invite_baseline_accepted');

    const timingInviteBaselineMissed = await repositories.addLead({
        accountName: 'Timing Invite Baseline Missed',
        firstName: 'Bruno',
        lastName: 'Baseline',
        jobTitle: 'CEO',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-invite-baseline-missed/',
        listName: 'timing-test',
    });
    assert.equal(timingInviteBaselineMissed, true);
    const leadInviteBaselineMissed = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-invite-baseline-missed/');
    assert.ok(leadInviteBaselineMissed);
    if (!leadInviteBaselineMissed) {
        throw new Error('Lead timing invite baseline missed non trovato');
    }
    await repositories.setLeadStatus(leadInviteBaselineMissed.id, 'READY_INVITE');
    await stateService.transitionLead(leadInviteBaselineMissed.id, 'INVITED', 'integration_timing_invite_baseline_sent');
    await repositories.recordLeadTimingAttribution(leadInviteBaselineMissed.id, 'invite', {
        strategy: 'baseline',
        segment: 'executive',
        score: 0.28,
        slotHour: null,
        slotDow: null,
        delaySec: 0,
        model: 'timing_optimizer_v2',
    });

    const timingInviteOptimizerAcceptedA = await repositories.addLead({
        accountName: 'Timing Invite Optimizer Accepted A',
        firstName: 'Carla',
        lastName: 'Optimizer',
        jobTitle: 'VP Sales',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-invite-optimizer-accepted-a/',
        listName: 'timing-test',
    });
    assert.equal(timingInviteOptimizerAcceptedA, true);
    const leadInviteOptimizerAcceptedA = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-invite-optimizer-accepted-a/');
    assert.ok(leadInviteOptimizerAcceptedA);
    if (!leadInviteOptimizerAcceptedA) {
        throw new Error('Lead timing invite optimizer accepted a non trovato');
    }
    await repositories.setLeadStatus(leadInviteOptimizerAcceptedA.id, 'READY_INVITE');
    await stateService.transitionLead(leadInviteOptimizerAcceptedA.id, 'INVITED', 'integration_timing_invite_optimizer_sent');
    await repositories.recordLeadTimingAttribution(leadInviteOptimizerAcceptedA.id, 'invite', {
        strategy: 'optimizer',
        segment: 'sales',
        score: 0.67,
        slotHour: 11,
        slotDow: 3,
        delaySec: 1800,
        model: 'timing_optimizer_v2',
    });
    await stateService.transitionLead(leadInviteOptimizerAcceptedA.id, 'ACCEPTED', 'integration_timing_invite_optimizer_accepted');

    const timingInviteOptimizerAcceptedB = await repositories.addLead({
        accountName: 'Timing Invite Optimizer Accepted B',
        firstName: 'Diego',
        lastName: 'Optimizer',
        jobTitle: 'VP Sales',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-invite-optimizer-accepted-b/',
        listName: 'timing-test',
    });
    assert.equal(timingInviteOptimizerAcceptedB, true);
    const leadInviteOptimizerAcceptedB = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-invite-optimizer-accepted-b/');
    assert.ok(leadInviteOptimizerAcceptedB);
    if (!leadInviteOptimizerAcceptedB) {
        throw new Error('Lead timing invite optimizer accepted b non trovato');
    }
    await repositories.setLeadStatus(leadInviteOptimizerAcceptedB.id, 'READY_INVITE');
    await stateService.transitionLead(leadInviteOptimizerAcceptedB.id, 'INVITED', 'integration_timing_invite_optimizer_sent');
    await repositories.recordLeadTimingAttribution(leadInviteOptimizerAcceptedB.id, 'invite', {
        strategy: 'optimizer',
        segment: 'sales',
        score: 0.71,
        slotHour: 14,
        slotDow: 4,
        delaySec: 1200,
        model: 'timing_optimizer_v2',
    });
    await stateService.transitionLead(leadInviteOptimizerAcceptedB.id, 'ACCEPTED', 'integration_timing_invite_optimizer_accepted');

    const timingMessageBaselineReplied = await repositories.addLead({
        accountName: 'Timing Message Baseline Replied',
        firstName: 'Elena',
        lastName: 'Baseline',
        jobTitle: 'Founder',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-message-baseline-replied/',
        listName: 'timing-test',
    });
    assert.equal(timingMessageBaselineReplied, true);
    const leadMessageBaselineReplied = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-message-baseline-replied/');
    assert.ok(leadMessageBaselineReplied);
    if (!leadMessageBaselineReplied) {
        throw new Error('Lead timing message baseline replied non trovato');
    }
    await repositories.setLeadStatus(leadMessageBaselineReplied.id, 'READY_MESSAGE');
    await stateService.transitionLead(leadMessageBaselineReplied.id, 'MESSAGED', 'integration_timing_message_baseline_sent');
    await repositories.recordLeadTimingAttribution(leadMessageBaselineReplied.id, 'message', {
        strategy: 'baseline',
        segment: 'founder',
        score: 0.31,
        slotHour: null,
        slotDow: null,
        delaySec: 0,
        model: 'timing_optimizer_v2',
    });
    await stateService.transitionLead(leadMessageBaselineReplied.id, 'REPLIED', 'integration_timing_message_baseline_replied');

    const timingMessageBaselineNoReply = await repositories.addLead({
        accountName: 'Timing Message Baseline No Reply',
        firstName: 'Fabio',
        lastName: 'Baseline',
        jobTitle: 'Founder',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-message-baseline-no-reply/',
        listName: 'timing-test',
    });
    assert.equal(timingMessageBaselineNoReply, true);
    const leadMessageBaselineNoReply = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-message-baseline-no-reply/');
    assert.ok(leadMessageBaselineNoReply);
    if (!leadMessageBaselineNoReply) {
        throw new Error('Lead timing message baseline no reply non trovato');
    }
    await repositories.setLeadStatus(leadMessageBaselineNoReply.id, 'READY_MESSAGE');
    await stateService.transitionLead(leadMessageBaselineNoReply.id, 'MESSAGED', 'integration_timing_message_baseline_sent');
    await repositories.recordLeadTimingAttribution(leadMessageBaselineNoReply.id, 'message', {
        strategy: 'baseline',
        segment: 'founder',
        score: 0.26,
        slotHour: null,
        slotDow: null,
        delaySec: 0,
        model: 'timing_optimizer_v2',
    });

    const timingMessageOptimizerRepliedA = await repositories.addLead({
        accountName: 'Timing Message Optimizer Replied A',
        firstName: 'Giulia',
        lastName: 'Optimizer',
        jobTitle: 'Head of Marketing',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-message-optimizer-replied-a/',
        listName: 'timing-test',
    });
    assert.equal(timingMessageOptimizerRepliedA, true);
    const leadMessageOptimizerRepliedA = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-message-optimizer-replied-a/');
    assert.ok(leadMessageOptimizerRepliedA);
    if (!leadMessageOptimizerRepliedA) {
        throw new Error('Lead timing message optimizer replied a non trovato');
    }
    await repositories.setLeadStatus(leadMessageOptimizerRepliedA.id, 'READY_MESSAGE');
    await stateService.transitionLead(leadMessageOptimizerRepliedA.id, 'MESSAGED', 'integration_timing_message_optimizer_sent');
    await repositories.recordLeadTimingAttribution(leadMessageOptimizerRepliedA.id, 'message', {
        strategy: 'optimizer',
        segment: 'marketing',
        score: 0.69,
        slotHour: 16,
        slotDow: 2,
        delaySec: 2400,
        model: 'timing_optimizer_v2',
    });
    await stateService.transitionLead(leadMessageOptimizerRepliedA.id, 'REPLIED', 'integration_timing_message_optimizer_replied');

    const timingMessageOptimizerRepliedB = await repositories.addLead({
        accountName: 'Timing Message Optimizer Replied B',
        firstName: 'Hugo',
        lastName: 'Optimizer',
        jobTitle: 'Head of Marketing',
        website: 'https://timing.example',
        linkedinUrl: 'https://www.linkedin.com/in/timing-message-optimizer-replied-b/',
        listName: 'timing-test',
    });
    assert.equal(timingMessageOptimizerRepliedB, true);
    const leadMessageOptimizerRepliedB = await repositories.getLeadByLinkedinUrl('https://www.linkedin.com/in/timing-message-optimizer-replied-b/');
    assert.ok(leadMessageOptimizerRepliedB);
    if (!leadMessageOptimizerRepliedB) {
        throw new Error('Lead timing message optimizer replied b non trovato');
    }
    await repositories.setLeadStatus(leadMessageOptimizerRepliedB.id, 'READY_MESSAGE');
    await stateService.transitionLead(leadMessageOptimizerRepliedB.id, 'MESSAGED', 'integration_timing_message_optimizer_sent');
    await repositories.recordLeadTimingAttribution(leadMessageOptimizerRepliedB.id, 'message', {
        strategy: 'optimizer',
        segment: 'marketing',
        score: 0.73,
        slotHour: 15,
        slotDow: 3,
        delaySec: 2000,
        model: 'timing_optimizer_v2',
    });
    await stateService.transitionLead(leadMessageOptimizerRepliedB.id, 'REPLIED', 'integration_timing_message_optimizer_replied');

    const inviteTimingReport = await timingOptimizer.getTimingExperimentReport('invite', 30);
    assert.equal(inviteTimingReport.baseline.sent >= 2, true);
    assert.equal(inviteTimingReport.optimizer.sent >= 2, true);
    assert.equal(inviteTimingReport.metric, 'acceptance');
    assert.equal(inviteTimingReport.liftAbsolute !== null, true);
    assert.equal(inviteTimingReport.optimizer.successRate > inviteTimingReport.baseline.successRate, true);

    const messageTimingReport = await timingOptimizer.getTimingExperimentReport('message', 30);
    assert.equal(messageTimingReport.baseline.sent >= 2, true);
    assert.equal(messageTimingReport.optimizer.sent >= 2, true);
    assert.equal(messageTimingReport.metric, 'reply');
    assert.equal(messageTimingReport.liftAbsolute !== null, true);
    assert.equal(messageTimingReport.optimizer.successRate > messageTimingReport.baseline.successRate, true);

    const originalRampEnabled = configModule.config.rampUpEnabled;
    const originalRampDailyIncrease = configModule.config.rampUpDailyIncrease;
    const originalRampNonLinearEnabled = configModule.config.rampUpNonLinearModelEnabled;
    const originalRampWarmupDays = configModule.config.rampUpModelWarmupDays;
    const originalRiskWarnThreshold = configModule.config.riskWarnThreshold;
    const originalLowActivityRiskThreshold = configModule.config.lowActivityRiskThreshold;
    const originalRiskStopThreshold = configModule.config.riskStopThreshold;
    const originalPendingRatioWarn = configModule.config.pendingRatioWarn;
    const originalPendingRatioStop = configModule.config.pendingRatioStop;
    const originalLowActivityEnabled = configModule.config.lowActivityEnabled;

    try {
        configModule.config.rampUpEnabled = true;
        configModule.config.rampUpDailyIncrease = 0.08;
        configModule.config.rampUpNonLinearModelEnabled = true;
        configModule.config.rampUpModelWarmupDays = 180;

        // Riduce la probabilita' di skip per rischio durante il test integrato del modello.
        configModule.config.riskWarnThreshold = 101;
        configModule.config.lowActivityRiskThreshold = 101;
        configModule.config.riskStopThreshold = 101;
        configModule.config.pendingRatioWarn = 2;
        configModule.config.pendingRatioStop = 2;
        configModule.config.lowActivityEnabled = false;

        await repositories.ensureLeadList('ramp-model-test');
        await repositories.updateLeadCampaignConfig('ramp-model-test', {
            isActive: true,
            priority: 1,
            dailyInviteCap: 3,
            dailyMessageCap: 4,
        });
        await repositories.setRuntimeFlag('rampup.last_run_date', '');

        const rampReport = await rampUpWorker.runRampUpWorker();
        assert.equal(rampReport.executed, true);
        assert.equal(rampReport.mode, 'non_linear');
        assert.equal(rampReport.updatedLists >= 1, true);

        const listsAfterRamp = await repositories.listLeadCampaignConfigs(false);
        const rampList = listsAfterRamp.find((row) => row.name === 'ramp-model-test');
        assert.ok(rampList);
        assert.equal((rampList?.dailyInviteCap ?? 0) >= 1, true);
        assert.equal((rampList?.dailyMessageCap ?? 0) >= 1, true);
        assert.equal((rampList?.dailyInviteCap ?? 0) <= configModule.config.rampUpMaxCap, true);
        assert.equal((rampList?.dailyMessageCap ?? 0) <= configModule.config.rampUpMaxCap, true);
    } finally {
        configModule.config.rampUpEnabled = originalRampEnabled;
        configModule.config.rampUpDailyIncrease = originalRampDailyIncrease;
        configModule.config.rampUpNonLinearModelEnabled = originalRampNonLinearEnabled;
        configModule.config.rampUpModelWarmupDays = originalRampWarmupDays;
        configModule.config.riskWarnThreshold = originalRiskWarnThreshold;
        configModule.config.lowActivityRiskThreshold = originalLowActivityRiskThreshold;
        configModule.config.riskStopThreshold = originalRiskStopThreshold;
        configModule.config.pendingRatioWarn = originalPendingRatioWarn;
        configModule.config.pendingRatioStop = originalPendingRatioStop;
        configModule.config.lowActivityEnabled = originalLowActivityEnabled;
    }

    const backupPath = await dbModule.backupDatabase();
    assert.equal(typeof backupPath, 'string');
    assert.equal(backupPath.endsWith('.sqlite'), true);

    const restoreDrill = await restoreDbScript.runRestoreDrill({
        backupFile: backupPath,
        triggeredBy: 'integration-test',
        keepArtifacts: false,
        reportDir: restoreDrillReportDir,
        persistRuntimeFlags: true,
    });
    assert.equal(restoreDrill.status, 'SUCCEEDED');
    assert.equal(restoreDrill.backupPath !== null, true);
    assert.equal(restoreDrill.integrityCheck, 'ok');
    assert.equal(restoreDrill.tableChecks.every((check) => check.exists), true);
    assert.equal(restoreDrill.reportPath !== null && fs.existsSync(restoreDrill.reportPath), true);
    if (restoreDrill.tempDbPath) {
        assert.equal(fs.existsSync(restoreDrill.tempDbPath), false);
    }

    const drLastStatus = await repositories.getRuntimeFlag('dr_restore_test_last_status');
    const drLastReportPath = await repositories.getRuntimeFlag('dr_restore_test_last_report_path');
    assert.equal(drLastStatus, 'SUCCEEDED');
    assert.equal(typeof drLastReportPath === 'string' && !!drLastReportPath, true);
    if (drLastReportPath) {
        assert.equal(fs.existsSync(drLastReportPath), true);
    }

    const featureDatasetA = await repositories.buildFeatureDatasetVersion({
        datasetName: 'integration_feature_store',
        datasetVersion: 'v1',
        actions: ['invite', 'message'],
        lookbackDays: 365,
        splitTrainPct: 80,
        splitValidationPct: 10,
        seed: 'integration-seed',
        forceRebuild: true,
        metadata: { source: 'integration-test' },
    });
    assert.equal(featureDatasetA.rowCount > 0, true);

    const featureDatasetB = await repositories.buildFeatureDatasetVersion({
        datasetName: 'integration_feature_store',
        datasetVersion: 'v1',
        actions: ['invite', 'message'],
        lookbackDays: 365,
        splitTrainPct: 80,
        splitValidationPct: 10,
        seed: 'integration-seed',
        forceRebuild: true,
        metadata: { source: 'integration-test' },
    });
    assert.equal(featureDatasetA.signatureSha256, featureDatasetB.signatureSha256);
    assert.equal(featureDatasetA.rowCount, featureDatasetB.rowCount);

    const featureRows = await repositories.getFeatureDatasetRows('integration_feature_store', 'v1');
    assert.equal(featureRows.length, featureDatasetB.rowCount);
    const computedFeatureSignature = repositories.computeFeatureDatasetSignature(
        featureRows.map((row) => ({
            sampleKey: row.sample_key,
            leadId: row.lead_id,
            action: row.action,
            eventAt: row.event_at,
            label: row.label,
            split: row.split,
            features: JSON.parse(row.features_json) as Record<string, unknown>,
            metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
        }))
    );
    assert.equal(computedFeatureSignature, featureDatasetB.signatureSha256);

    if (fs.existsSync(featureStoreExportDir)) {
        fs.rmSync(featureStoreExportDir, { recursive: true, force: true });
    }
    fs.mkdirSync(featureStoreExportDir, { recursive: true });

    const originalConsoleLogFeatureStore = console.log;
    const featureStoreLogs: string[] = [];
    console.log = (...parts: unknown[]) => {
        featureStoreLogs.push(parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    };
    try {
        await adminCommands.runFeatureStoreCommand([
            'export',
            '--dataset', 'integration_feature_store',
            '--version', 'v1',
            '--out-dir', featureStoreExportDir,
        ]);
    } finally {
        console.log = originalConsoleLogFeatureStore;
    }
    assert.equal(featureStoreLogs.length >= 1, true);
    const exportPayload = JSON.parse(featureStoreLogs[featureStoreLogs.length - 1] ?? '{}') as {
        manifestPath?: string;
        dataPath?: string;
    };
    assert.equal(typeof exportPayload.manifestPath, 'string');
    assert.equal(typeof exportPayload.dataPath, 'string');
    const manifestPath = exportPayload.manifestPath ?? '';
    const dataPath = exportPayload.dataPath ?? '';
    assert.equal(fs.existsSync(manifestPath), true);
    assert.equal(fs.existsSync(dataPath), true);

    const originalManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    originalManifest.datasetVersion = 'v1_copy';
    const manifestCopyPath = path.join(featureStoreExportDir, 'integration_feature_store.v1_copy.manifest.json');
    fs.writeFileSync(manifestCopyPath, JSON.stringify(originalManifest, null, 2), 'utf8');

    await adminCommands.runFeatureStoreCommand([
        'import',
        '--manifest', manifestCopyPath,
        '--force',
    ]);

    const importedFeatureDataset = await repositories.getFeatureDatasetVersion('integration_feature_store', 'v1_copy');
    assert.ok(importedFeatureDataset);
    assert.equal(importedFeatureDataset?.row_count, featureDatasetB.rowCount);
    assert.equal(importedFeatureDataset?.signature_sha256, featureDatasetB.signatureSha256);

    const selectorRollbackAction = 'integration.selector.rollback.action';
    const selectorRollbackCss = 'button[data-test="rollback-connect"]';
    await repositories.upsertDynamicSelector(selectorRollbackAction, selectorRollbackCss, 0.22, 'seed_model');
    for (let i = 0; i < 5; i++) {
        await repositories.recordSelectorFallbackSuccess(
            selectorRollbackAction,
            selectorRollbackCss,
            `https://www.linkedin.com/in/selector-rollback-${i}/`
        );
    }

    const learnerRunA = await selectorLearner.runSelectorLearner({
        minSuccess: 3,
        limit: 25,
        lookbackDays: 14,
        failureDegradeRatio: 0.1,
        failureDegradeMinDelta: 1,
        autoRollback: true,
        skipPromotionOnRollback: true,
        triggeredBy: 'integration-test',
    });
    assert.equal(learnerRunA.promotedSelectors >= 1, true);
    assert.equal(learnerRunA.status, 'PROMOTED');

    const promotedCandidates = await repositories.listDynamicSelectorCandidates(selectorRollbackAction, 5);
    const promotedRollbackSelector = promotedCandidates.find((row) => row.selector === selectorRollbackCss);
    assert.ok(promotedRollbackSelector);
    assert.equal((promotedRollbackSelector?.source ?? '').startsWith('selector_learner.run:'), true);
    assert.equal((promotedRollbackSelector?.confidence ?? 0) > 0.22, true);

    await repositories.recordSelectorFailure(
        selectorRollbackAction,
        'https://www.linkedin.com/in/selector-rollback-regression/',
        [selectorRollbackCss],
        'forced selector regression for rollback integration test'
    );

    const learnerRunB = await selectorLearner.runSelectorLearner({
        minSuccess: 3,
        limit: 25,
        lookbackDays: 14,
        failureDegradeRatio: 0.1,
        failureDegradeMinDelta: 1,
        autoRollback: true,
        skipPromotionOnRollback: true,
        triggeredBy: 'integration-test',
    });

    assert.equal(learnerRunB.status, 'ROLLBACK_ONLY');
    assert.equal(learnerRunB.rollback?.degraded, true);
    assert.equal(learnerRunB.rollback?.rolledBack, true);

    const restoredCandidates = await repositories.listDynamicSelectorCandidates(selectorRollbackAction, 5);
    const restoredRollbackSelector = restoredCandidates.find((row) => row.selector === selectorRollbackCss);
    assert.ok(restoredRollbackSelector);
    assert.equal(restoredRollbackSelector?.source, 'seed_model');
    assert.equal(Math.abs((restoredRollbackSelector?.confidence ?? 0) - 0.22) < 0.0001, true);

    const selectorLearningRuns = await repositories.listSelectorLearningRuns(10);
    assert.equal(selectorLearningRuns.length >= 2, true);
    assert.equal(selectorLearningRuns.some((row) => row.status === 'ROLLED_BACK'), true);
    assert.equal(selectorLearningRuns.some((row) => row.status === 'ROLLBACK_ONLY'), true);

        httpServer = serverModule.startServer(0);
        const address = httpServer.address() as AddressInfo | null;
        if (!address || !address.port) {
            throw new Error('Impossibile ottenere la porta del server test');
        }
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const unauthorized = await fetch(`${baseUrl}/api/kpis`);
        assert.equal(unauthorized.status, 401);
        assert.equal((unauthorized.headers.get('x-correlation-id') ?? '').length > 0, true);

        const unauthorizedV1 = await fetch(`${baseUrl}/api/v1/meta`);
        assert.equal(unauthorizedV1.status, 401);

        const spoofedForwarded = await fetch(`${baseUrl}/api/kpis`, {
            headers: { 'x-forwarded-for': '127.0.0.1' },
        });
        assert.equal(spoofedForwarded.status, 401);

        const v1Meta = await fetch(`${baseUrl}/api/v1/meta`, {
            headers: { 'x-api-key': 'integration-dashboard-key' },
        });
        assert.equal(v1Meta.status, 200);
        const v1MetaBody = await v1Meta.json() as {
            apiVersion?: string;
            requestId?: string;
            data?: {
                service?: string;
                supportedVersions?: string[];
                endpoints?: Array<{ path?: string; method?: string }>;
            };
        };
        assert.equal(v1MetaBody.apiVersion, 'v1');
        assert.equal((v1MetaBody.requestId ?? '').length > 0, true);
        assert.equal(v1MetaBody.data?.service, 'linkedin-bot');
        assert.equal((v1MetaBody.data?.supportedVersions ?? []).includes('v1'), true);
        assert.equal((v1MetaBody.data?.endpoints ?? []).some((endpoint) => endpoint.path === '/api/v1/automation/snapshot'), true);

        const v1Snapshot = await fetch(`${baseUrl}/api/v1/automation/snapshot`, {
            headers: { 'x-api-key': 'integration-dashboard-key' },
        });
        assert.equal(v1Snapshot.status, 200);
        const v1SnapshotBody = await v1Snapshot.json() as {
            apiVersion?: string;
            data?: {
                localDate?: string;
                system?: { pausedUntil?: string | null; quarantined?: boolean };
                funnel?: { totalLeads?: number };
                observability?: {
                    sloStatus?: string;
                    selectorCacheKpi?: {
                        targetMet?: boolean;
                        validationStatus?: string;
                    };
                };
            };
        };
        assert.equal(v1SnapshotBody.apiVersion, 'v1');
        assert.equal(typeof v1SnapshotBody.data?.localDate, 'string');
        assert.equal(typeof v1SnapshotBody.data?.system?.quarantined, 'boolean');
        assert.equal(typeof v1SnapshotBody.data?.funnel?.totalLeads, 'number');
        assert.equal(
            v1SnapshotBody.data?.observability?.sloStatus === 'OK'
            || v1SnapshotBody.data?.observability?.sloStatus === 'WARN'
            || v1SnapshotBody.data?.observability?.sloStatus === 'CRITICAL',
            true
        );
        assert.equal(typeof v1SnapshotBody.data?.observability?.selectorCacheKpi?.targetMet, 'boolean');
        assert.equal(
            v1SnapshotBody.data?.observability?.selectorCacheKpi?.validationStatus === 'PASS'
            || v1SnapshotBody.data?.observability?.selectorCacheKpi?.validationStatus === 'WARN'
            || v1SnapshotBody.data?.observability?.selectorCacheKpi?.validationStatus === 'INSUFFICIENT_DATA',
            true
        );

        const v1Pause = await fetch(`${baseUrl}/api/v1/automation/controls/pause`, {
            method: 'POST',
            headers: {
                'x-api-key': 'integration-dashboard-key',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ minutes: 5 }),
        });
        assert.equal(v1Pause.status, 200);
        const v1PauseBody = await v1Pause.json() as {
            apiVersion?: string;
            data?: { success?: boolean; action?: string; minutes?: number };
        };
        assert.equal(v1PauseBody.apiVersion, 'v1');
        assert.equal(v1PauseBody.data?.success, true);
        assert.equal(v1PauseBody.data?.action, 'pause');
        assert.equal(v1PauseBody.data?.minutes, 5);

        const v1Resume = await fetch(`${baseUrl}/api/v1/automation/controls/resume`, {
            method: 'POST',
            headers: { 'x-api-key': 'integration-dashboard-key' },
        });
        assert.equal(v1Resume.status, 200);
        const v1ResumeBody = await v1Resume.json() as {
            apiVersion?: string;
            data?: { success?: boolean; action?: string };
        };
        assert.equal(v1ResumeBody.apiVersion, 'v1');
        assert.equal(v1ResumeBody.data?.success, true);
        assert.equal(v1ResumeBody.data?.action, 'resume');

        for (let attempt = 1; attempt <= 5; attempt++) {
            const failedBootstrap = await fetch(`${baseUrl}/api/auth/session`, {
                method: 'POST',
                headers: { 'x-api-key': `invalid-key-${attempt}` },
            });
            const expectedStatus = attempt < 5 ? 401 : 429;
            assert.equal(failedBootstrap.status, expectedStatus);
        }

        const bootstrapSession = await fetch(`${baseUrl}/api/auth/session`, {
            method: 'POST',
            headers: { 'x-api-key': 'integration-dashboard-key' },
        });
        assert.equal(bootstrapSession.status, 200);
        const setCookie = bootstrapSession.headers.get('set-cookie') ?? '';
        assert.equal(setCookie.includes('dashboard_session='), true);
        const cookieHeader = setCookie.split(';')[0] ?? '';
        assert.equal(cookieHeader.length > 0, true);

        const authorizedKpis = await fetch(`${baseUrl}/api/kpis`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(authorizedKpis.status, 200);

        const observability = await fetch(`${baseUrl}/api/observability`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(observability.status, 200);
        const observabilityBody = await observability.json() as {
            queuedJobs?: number;
            queueLagSeconds?: number;
            lockContention?: { acquireContended?: number };
            alerts?: Array<{ code?: string }>;
            circuitBreakers?: Array<{
                key?: string;
                status?: string;
                blockedCount?: number;
                openedCount?: number;
                halfOpenCount?: number;
                closedCount?: number;
            }>;
            slo?: {
                status?: string;
                windows?: Array<{ windowDays?: number; status?: string }>;
            };
            selectorCacheKpi?: {
                windowDays?: number;
                targetMet?: boolean;
                validationStatus?: string;
            };
        };
        assert.equal(typeof observabilityBody.queuedJobs, 'number');
        assert.equal(typeof observabilityBody.queueLagSeconds, 'number');
        assert.equal((observabilityBody.lockContention?.acquireContended ?? 0) >= 1, true);
        assert.equal(Array.isArray(observabilityBody.alerts), true);
        assert.equal(Array.isArray(observabilityBody.circuitBreakers), true);
        for (const breaker of observabilityBody.circuitBreakers ?? []) {
            assert.equal(typeof breaker.key, 'string');
            assert.equal(
                breaker.status === 'CLOSED' || breaker.status === 'OPEN' || breaker.status === 'HALF_OPEN',
                true
            );
            assert.equal(typeof breaker.blockedCount, 'number');
            assert.equal(typeof breaker.openedCount, 'number');
            assert.equal(typeof breaker.halfOpenCount, 'number');
            assert.equal(typeof breaker.closedCount, 'number');
        }
        assert.equal(
            observabilityBody.slo?.status === 'OK'
            || observabilityBody.slo?.status === 'WARN'
            || observabilityBody.slo?.status === 'CRITICAL',
            true
        );
        assert.equal(Array.isArray(observabilityBody.slo?.windows), true);
        assert.equal((observabilityBody.slo?.windows?.some((row) => row.windowDays === 7) ?? false), true);
        assert.equal((observabilityBody.slo?.windows?.some((row) => row.windowDays === 30) ?? false), true);
        assert.equal(observabilityBody.selectorCacheKpi?.windowDays, 7);
        assert.equal(typeof observabilityBody.selectorCacheKpi?.targetMet, 'boolean');
        assert.equal(
            observabilityBody.selectorCacheKpi?.validationStatus === 'PASS'
            || observabilityBody.selectorCacheKpi?.validationStatus === 'WARN'
            || observabilityBody.selectorCacheKpi?.validationStatus === 'INSUFFICIENT_DATA',
            true
        );

        const observabilitySlo = await fetch(`${baseUrl}/api/observability/slo`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(observabilitySlo.status, 200);
        const observabilitySloBody = await observabilitySlo.json() as {
            status?: string;
            thresholds?: { errorRateWarn?: number };
            windows?: Array<{ windowDays?: number; errorRate?: number }>;
        };
        assert.equal(
            observabilitySloBody.status === 'OK'
            || observabilitySloBody.status === 'WARN'
            || observabilitySloBody.status === 'CRITICAL',
            true
        );
        assert.equal(typeof observabilitySloBody.thresholds?.errorRateWarn, 'number');
        assert.equal(Array.isArray(observabilitySloBody.windows), true);
        assert.equal((observabilitySloBody.windows?.length ?? 0) >= 2, true);

        const aiQuality = await fetch(`${baseUrl}/api/ai/quality?days=7`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(aiQuality.status, 200);
        const aiQualityBody = await aiQuality.json() as {
            lookbackDays?: number;
            variants?: unknown[];
        };
        assert.equal(aiQualityBody.lookbackDays, 7);
        assert.equal(Array.isArray(aiQualityBody.variants), true);

        const commentSuggestions = await fetch(`${baseUrl}/api/ai/comment-suggestions?limit=10`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(commentSuggestions.status, 200);
        const commentSuggestionsBody = await commentSuggestions.json() as {
            status?: string;
            count?: number;
            rows?: Array<{
                leadId: number;
                suggestionIndex: number;
                status: string;
            }>;
        };
        assert.equal(commentSuggestionsBody.status, 'REVIEW_PENDING');
        assert.equal((commentSuggestionsBody.count ?? 0) >= 2, true);
        assert.equal(Array.isArray(commentSuggestionsBody.rows), true);
        const firstSuggestion = commentSuggestionsBody.rows?.[0];
        assert.ok(firstSuggestion);
        if (!firstSuggestion) {
            throw new Error('Comment suggestion non disponibile per integrazione');
        }

        const approveSuggestionResp = await fetch(
            `${baseUrl}/api/ai/comment-suggestions/${firstSuggestion.leadId}/${firstSuggestion.suggestionIndex}/approve`,
            {
                method: 'POST',
                headers: {
                    cookie: cookieHeader,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    comment: 'Commento approvato: ottimo spunto, quale metrica guida la prossima iterazione?',
                }),
            }
        );
        assert.equal(approveSuggestionResp.status, 200);
        const approveSuggestionBody = await approveSuggestionResp.json() as {
            leadId?: number;
            status?: string;
            reviewRequired?: boolean;
            comment?: string;
        };
        assert.equal(approveSuggestionBody.leadId, firstSuggestion.leadId);
        assert.equal(approveSuggestionBody.status, 'APPROVED');
        assert.equal(typeof approveSuggestionBody.reviewRequired, 'boolean');
        assert.equal((approveSuggestionBody.comment ?? '').length >= 20, true);

        const pendingAfterApprove = await fetch(`${baseUrl}/api/ai/comment-suggestions?limit=10`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(pendingAfterApprove.status, 200);
        const pendingAfterApproveBody = await pendingAfterApprove.json() as {
            count?: number;
            rows?: Array<{
                leadId: number;
                suggestionIndex: number;
            }>;
        };
        assert.equal((pendingAfterApproveBody.count ?? 0) >= 1, true);
        const rejectTarget = pendingAfterApproveBody.rows?.[0];
        assert.ok(rejectTarget);
        if (!rejectTarget) {
            throw new Error('Nessuna suggestion disponibile per reject');
        }

        const rejectSuggestionResp = await fetch(
            `${baseUrl}/api/ai/comment-suggestions/${rejectTarget.leadId}/${rejectTarget.suggestionIndex}/reject`,
            {
                method: 'POST',
                headers: { cookie: cookieHeader },
            }
        );
        assert.equal(rejectSuggestionResp.status, 200);
        const rejectSuggestionBody = await rejectSuggestionResp.json() as {
            status?: string;
            reviewRequired?: boolean;
        };
        assert.equal(rejectSuggestionBody.status, 'REJECTED');
        assert.equal(typeof rejectSuggestionBody.reviewRequired, 'boolean');

        const timingSlotsWithExperiment = await fetch(`${baseUrl}/api/ml/timing-slots?action=invite&n=3&includeExperiment=true&lookbackDays=30`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(timingSlotsWithExperiment.status, 200);
        const timingBody = await timingSlotsWithExperiment.json() as {
            action?: string;
            slots?: unknown[];
            experiment?: {
                action?: string;
                metric?: string;
                baseline?: { sent?: number };
                optimizer?: { sent?: number };
            };
        };
        assert.equal(timingBody.action, 'invite');
        assert.equal(Array.isArray(timingBody.slots), true);
        assert.equal(timingBody.experiment?.action, 'invite');
        assert.equal(timingBody.experiment?.metric, 'acceptance');
        assert.equal((timingBody.experiment?.baseline?.sent ?? 0) >= 1, true);
        assert.equal((timingBody.experiment?.optimizer?.sent ?? 0) >= 1, true);

        const aiValidationRun = await fetch(`${baseUrl}/api/ai/quality/run`, {
            method: 'POST',
            headers: {
                cookie: cookieHeader,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ triggeredBy: 'integration-test' }),
        });
        assert.equal(aiValidationRun.status, 200);

        const accountHealthResp = await fetch(`${baseUrl}/api/accounts/health`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(accountHealthResp.status, 200);
        const accountHealthBody = await accountHealthResp.json() as { rows?: unknown[] };
        assert.equal(Array.isArray(accountHealthBody.rows), true);

        const securityAuditResp = await fetch(`${baseUrl}/api/security/audit?limit=10`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(securityAuditResp.status, 200);
        const securityAuditBody = await securityAuditResp.json() as { rows?: unknown[] };
        assert.equal(Array.isArray(securityAuditBody.rows), true);

        const backupsResp = await fetch(`${baseUrl}/api/backups?limit=5`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(backupsResp.status, 200);
        const backupsBody = await backupsResp.json() as { rows?: unknown[] };
        assert.equal(Array.isArray(backupsBody.rows), true);

        const rotatedSession = await fetch(`${baseUrl}/api/auth/session`, {
            method: 'POST',
            headers: { cookie: cookieHeader },
        });
        assert.equal(rotatedSession.status, 200);
        const rotatedSetCookie = rotatedSession.headers.get('set-cookie') ?? '';
        assert.equal(rotatedSetCookie.includes('dashboard_session='), true);
        const rotatedCookieHeader = rotatedSetCookie.split(';')[0] ?? '';
        assert.equal(rotatedCookieHeader.length > 0, true);
        assert.equal(rotatedCookieHeader !== cookieHeader, true);

        const oldCookieAfterRotation = await fetch(`${baseUrl}/api/kpis`, {
            headers: { cookie: cookieHeader },
        });
        assert.equal(oldCookieAfterRotation.status, 401);

        const authorizedWithRotatedCookie = await fetch(`${baseUrl}/api/kpis`, {
            headers: { cookie: rotatedCookieHeader },
        });
        assert.equal(authorizedWithRotatedCookie.status, 200);

        const sseResp = await fetch(`${baseUrl}/api/events`, {
            headers: { cookie: rotatedCookieHeader },
        });
        assert.equal(sseResp.status, 200);
        const reader = sseResp.body?.getReader();
        if (!reader) {
            throw new Error('SSE stream non disponibile');
        }
        const firstChunk = await reader.read();
        const firstPayload = Buffer.from(firstChunk.value ?? new Uint8Array()).toString('utf8');
        assert.equal(firstPayload.includes('event: connected'), true);
        await reader.cancel();

        const logoutResp = await fetch(`${baseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { cookie: rotatedCookieHeader },
        });
        assert.equal(logoutResp.status, 200);
        const logoutSetCookie = logoutResp.headers.get('set-cookie') ?? '';
        assert.equal(/dashboard_session=.*Max-Age=0/i.test(logoutSetCookie), true);

        const revokedCookieAccess = await fetch(`${baseUrl}/api/kpis`, {
            headers: { cookie: rotatedCookieHeader },
        });
        assert.equal(revokedCookieAccess.status, 401);
    } finally {
        if (httpServer) {
            await new Promise<void>((resolve) => {
                httpServer?.close(() => resolve());
            });
        }
        await dbModule.closeDatabase();
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        if (fs.existsSync(rotationEnvPath)) {
            fs.unlinkSync(rotationEnvPath);
        }
        if (fs.existsSync(featureStoreExportDir)) {
            fs.rmSync(featureStoreExportDir, { recursive: true, force: true });
        }
        if (fs.existsSync(restoreDrillReportDir)) {
            fs.rmSync(restoreDrillReportDir, { recursive: true, force: true });
        }
    }
}

run()
    .then(() => {
        console.log('Integration tests passed.');
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
