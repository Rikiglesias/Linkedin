/**
 * replCommand.ts — Interactive REPL with pre-loaded bot context
 *
 * Provides a Node.js REPL with database, config, and repository functions
 * available as global variables for quick debugging and data inspection.
 */

import repl from 'repl';
import { getDatabase } from '../../db';
import { config, getLocalDateString } from '../../config';

export async function runReplCommand(): Promise<void> {
    const db = await getDatabase();

    // Lazy-load repositories to avoid circular import issues
    const repositories = await import('../../core/repositories');

    console.log('LinkedIn Bot Interactive REPL');
    console.log('────────────────────────────────────────');
    console.log('Variabili disponibili:');
    console.log('  db         — DatabaseManager instance');
    console.log('  config     — AppConfig');
    console.log('  repos      — all repository functions');
    console.log('  localDate  — oggi (YYYY-MM-DD)');
    console.log('  sql(query) — shortcut per db.query(query)');
    console.log('────────────────────────────────────────');
    console.log('Esempio: await repos.getGlobalKPIData()');
    console.log('Esempio: await sql("SELECT count(*) as n FROM leads")');
    console.log('Ctrl+D per uscire.\n');

    const server = repl.start({
        prompt: 'bot> ',
        useGlobal: false,
    });

    // Inject context
    server.context.db = db;
    server.context.config = config;
    server.context.repos = repositories;
    server.context.localDate = getLocalDateString();
    server.context.sql = async (query: string, params?: unknown[]) => {
        return db.query(query, params ?? []);
    };

    // Return a promise that resolves when REPL exits
    await new Promise<void>((resolve) => {
        server.on('exit', () => {
            console.log('\n[REPL] Sessione terminata.');
            resolve();
        });
    });
}
