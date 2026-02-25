import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function run(): Promise<void> {
    const testDbPath = path.resolve(process.cwd(), 'data', 'test_integration.sqlite');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    process.env.DB_PATH = testDbPath;
    process.env.SUPABASE_SYNC_ENABLED = 'false';
    process.env.SELECTOR_CANARY_ENABLED = 'false';

    const dbModule = await import('../db');
    const repositories = await import('../core/repositories');
    const stateService = await import('../core/leadStateService');

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

    await repositories.promoteNewLeadsToReadyInvite(10);
    const ready = await repositories.getLeadsByStatus('READY_INVITE', 10);
    assert.equal(ready.length, 1);

    const lead = ready[0];
    await stateService.transitionLead(lead.id, 'INVITED', 'integration_invite');
    const invited = await repositories.getLeadsByStatus('INVITED', 10);
    assert.equal(invited.length, 1);

    await stateService.reconcileLeadStatus(lead.id, 'READY_INVITE', 'integration_reconcile_back');
    const readyAgain = await repositories.getLeadsByStatus('READY_INVITE', 10);
    assert.equal(readyAgain.length, 1);
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

    await dbModule.closeDatabase();
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
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
