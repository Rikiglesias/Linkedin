import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function run(): Promise<void> {
    const testDbPath = path.resolve(process.cwd(), 'data', 'test_e2e_dry.sqlite');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    process.env.DB_PATH = testDbPath;
    process.env.SUPABASE_SYNC_ENABLED = 'false';
    process.env.SELECTOR_CANARY_ENABLED = 'false';
    process.env.HOUR_START = '0';
    process.env.HOUR_END = '24';

    const dbModule = await import('../db');
    const repositories = await import('../core/repositories');
    const orchestrator = await import('../core/orchestrator');

    await dbModule.initDatabase();

    // Seed: crea lead in diverse fasi per testare tutti i workflow
    await repositories.addLead({
        accountName: 'Dry Run Srl',
        firstName: 'Dry',
        lastName: 'Run',
        jobTitle: 'Test Lead',
        website: 'https://example.org',
        linkedinUrl: 'https://www.linkedin.com/in/dry-run-lead-test/',
        listName: 'dry-list',
    });
    await repositories.addLead({
        accountName: 'Message Test Corp',
        firstName: 'Msg',
        lastName: 'Test',
        jobTitle: 'CTO',
        website: 'https://example.com',
        linkedinUrl: 'https://www.linkedin.com/in/msg-test-lead/',
        listName: 'dry-list',
    });
    await repositories.promoteNewLeadsToReadyInvite(10);

    // ── Workflow 1: invite dry-run ─────────────────────────────────────────
    console.log('[E2E] Testing workflow: invite (dry-run)...');
    await orchestrator.runWorkflow({ workflow: 'invite', dryRun: true });
    assert.ok(true, 'invite dry-run completato senza eccezioni');

    // ── Workflow 2: check dry-run ──────────────────────────────────────────
    console.log('[E2E] Testing workflow: check (dry-run)...');
    await orchestrator.runWorkflow({ workflow: 'check', dryRun: true });
    assert.ok(true, 'check dry-run completato senza eccezioni');

    // ── Workflow 3: message dry-run ────────────────────────────────────────
    console.log('[E2E] Testing workflow: message (dry-run)...');
    await orchestrator.runWorkflow({ workflow: 'message', dryRun: true });
    assert.ok(true, 'message dry-run completato senza eccezioni');

    // ── Workflow 4: all dry-run ────────────────────────────────────────────
    console.log('[E2E] Testing workflow: all (dry-run)...');
    await orchestrator.runWorkflow({ workflow: 'all', dryRun: true });
    assert.ok(true, 'all dry-run completato senza eccezioni');

    // ── Verifica nuove funzioni esportate (TODO 1.3-6.7) ──────────────────
    console.log('[E2E] Testing new exported functions...');

    // 1.3: Trust Score
    const { getAccountTrustInputs, computeListPerformanceMultiplier } = await import('../core/repositories');
    const trustInputs = await getAccountTrustInputs(55, 30);
    assert.equal(typeof trustInputs.acceptanceRatePct, 'number');
    assert.equal(typeof trustInputs.pendingRatio, 'number');

    // 2.1: List Performance Multiplier
    const listPerf = await computeListPerformanceMultiplier('dry-list', 30);
    assert.equal(typeof listPerf.multiplier, 'number');
    assert.ok(
        listPerf.multiplier >= 0.25 && listPerf.multiplier <= 1.15,
        `multiplier ${listPerf.multiplier} fuori range`,
    );

    // 5.1: Session Risk Level
    const { computeSessionRiskLevel, collectConfigStatus } = await import('../workflows/preflight');
    const cfgStatus = await collectConfigStatus();
    const riskLevel = await computeSessionRiskLevel(cfgStatus);
    assert.ok(['GO', 'CAUTION', 'STOP'].includes(riskLevel.level), `risk level ${riskLevel.level} non valido`);
    assert.ok(riskLevel.score >= 0 && riskLevel.score <= 100, `risk score ${riskLevel.score} fuori range`);

    // 5.4: Ban Probability
    const { estimateBanProbability } = await import('../risk/riskEngine');
    const banProb = estimateBanProbability([], 50, 0, 0.2);
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(banProb.level));
    assert.ok(banProb.score >= 0 && banProb.score <= 100);

    // 6.7: Breadcrumbs
    const { addBreadcrumb, formatBreadcrumbs } = await import('../workers/context');
    const fakeContext = {
        session: null as unknown,
        dryRun: true,
        localDate: '',
        accountId: 'test',
    } as import('../workers/context').WorkerContext;
    addBreadcrumb(fakeContext, 'test_action', 'test_detail');
    assert.ok(fakeContext.breadcrumbs?.length === 1);
    const formatted = formatBreadcrumbs(fakeContext);
    assert.ok(formatted.includes('test_action'));

    console.log('[E2E] All new function exports verified.');

    await dbModule.closeDatabase();
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
}

run()
    .then(() => {
        console.log('Dry-run scenario passed (4 workflows + new functions).');
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
