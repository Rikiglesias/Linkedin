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

    let httpServer: ReturnType<typeof serverModule.startServer> | null = null;

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

        httpServer = serverModule.startServer(0);
        const address = httpServer.address() as AddressInfo | null;
        if (!address || !address.port) {
            throw new Error('Impossibile ottenere la porta del server test');
        }
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const unauthorized = await fetch(`${baseUrl}/api/kpis`);
        assert.equal(unauthorized.status, 401);
        assert.equal((unauthorized.headers.get('x-correlation-id') ?? '').length > 0, true);

        const spoofedForwarded = await fetch(`${baseUrl}/api/kpis`, {
            headers: { 'x-forwarded-for': '127.0.0.1' },
        });
        assert.equal(spoofedForwarded.status, 401);

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
            circuitBreakers?: unknown[];
        };
        assert.equal(typeof observabilityBody.queuedJobs, 'number');
        assert.equal(typeof observabilityBody.queueLagSeconds, 'number');
        assert.equal((observabilityBody.lockContention?.acquireContended ?? 0) >= 1, true);
        assert.equal(Array.isArray(observabilityBody.alerts), true);
        assert.equal(Array.isArray(observabilityBody.circuitBreakers), true);

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
