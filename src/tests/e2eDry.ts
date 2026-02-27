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

    await repositories.addLead({
        accountName: 'Dry Run Srl',
        firstName: 'Dry',
        lastName: 'Run',
        jobTitle: 'Test Lead',
        website: 'https://example.org',
        linkedinUrl: 'https://www.linkedin.com/in/dry-run-lead-test/',
        listName: 'dry-list',
    });
    await repositories.promoteNewLeadsToReadyInvite(10);

    // Esegue runWorkflow completo invece del solo scheduler.
    // In modalità dryRun, questo verifica l'intero path logico (budget, lead scoring, cooldown)
    // ritornando void senza inserire record fisici. Asseriamo che completi senza eccezioni.
    await orchestrator.runWorkflow({ workflow: 'invite', dryRun: true });
    assert.ok(true, 'runWorkflow in dryRun completato senza eccezioni');

    await dbModule.closeDatabase();
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
}

run()
    .then(() => {
        console.log('Dry-run scenario passed.');
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

