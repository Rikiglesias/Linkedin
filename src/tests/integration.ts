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

    let httpServer: ReturnType<typeof serverModule.startServer> | null = null;

    try {
        await dbModule.initDatabase();

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

        const spoofedForwarded = await fetch(`${baseUrl}/api/kpis`, {
            headers: { 'x-forwarded-for': '127.0.0.1' },
        });
        assert.equal(spoofedForwarded.status, 401);

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

        const sseResp = await fetch(`${baseUrl}/api/events`, {
            headers: { cookie: cookieHeader },
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
