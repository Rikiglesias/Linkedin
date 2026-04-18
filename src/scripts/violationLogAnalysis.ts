/**
 * violationLogAnalysis.ts — Analisi log violazioni e hook per identificare pattern ricorrenti
 *
 * Legge i log generati dagli hook e produce statistiche su:
 * - violazioni antiban (block e miss)
 * - frequenza operazioni git
 * - comandi di qualita' eseguiti
 * - sessioni e durata
 *
 * Uso:
 *   npx ts-node src/scripts/violationLogAnalysis.ts
 *   npm run audit:violations
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MEMORY = join(homedir(), 'memory');

interface LogEntry {
    timestamp: string;
    message: string;
}

function parseLog(filePath: string): LogEntry[] {
    if (!existsSync(filePath)) return [];
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.map((line) => {
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (.+)$/);
        if (!match) return { timestamp: '', message: line };
        return { timestamp: match[1], message: match[2] };
    });
}

function countByPattern(entries: LogEntry[], pattern: RegExp): number {
    return entries.filter((e) => pattern.test(e.message)).length;
}

function uniqueDays(entries: LogEntry[]): string[] {
    const days = new Set(entries.map((e) => e.timestamp.split(' ')[0]).filter(Boolean));
    return [...days].sort();
}

function run(): void {
    console.log('\n=== Violation & Hook Log Analysis ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    // --- Antiban log ---
    const antibanLog = parseLog(join(MEMORY, 'antiban-hook-log.txt'));
    const hardBlocks = countByPattern(antibanLog, /ANTIBAN HARD-BLOCK/);
    const antibanDays = uniqueDays(antibanLog);

    console.log('--- Antiban Hook ---');
    console.log(`  Entries totali: ${antibanLog.length}`);
    console.log(`  Hard blocks: ${hardBlocks}`);
    console.log(`  Giorni attivi: ${antibanDays.length}`);
    if (antibanDays.length > 0) {
        console.log(`  Range: ${antibanDays[0]} → ${antibanDays[antibanDays.length - 1]}`);
    }

    // --- Violations log ---
    const violationsLog = parseLog(join(MEMORY, 'rule-violations-log.txt'));
    const misses = countByPattern(violationsLog, /POSSIBLE_RULE_MISS/);
    const violDays = uniqueDays(violationsLog);

    console.log('\n--- Rule Violations ---');
    console.log(`  Entries totali: ${violationsLog.length}`);
    console.log(`  Possible misses: ${misses}`);
    console.log(`  Giorni con violazioni: ${violDays.length}`);
    if (violDays.length > 0) {
        console.log(`  Range: ${violDays[0]} → ${violDays[violDays.length - 1]}`);
    }

    // --- Quality log ---
    const qualityLog = parseLog(join(MEMORY, 'quality-hook-log.txt'));
    const tscRuns = countByPattern(qualityLog, /tsc|typecheck/);
    const vitestRuns = countByPattern(qualityLog, /vitest|test:vitest|conta-problemi|post-modifiche/);
    const madgeRuns = countByPattern(qualityLog, /madge/);
    const qualityDays = uniqueDays(qualityLog);

    console.log('\n--- Quality Commands ---');
    console.log(`  Entries totali: ${qualityLog.length}`);
    console.log(`  tsc: ${tscRuns} | vitest: ${vitestRuns} | madge: ${madgeRuns}`);
    console.log(`  Giorni attivi: ${qualityDays.length}`);

    // --- Git log ---
    const gitLog = parseLog(join(MEMORY, 'git-hook-log.txt'));
    const commits = countByPattern(gitLog, /commit/i);
    const pushes = countByPattern(gitLog, /push/i);
    const gitDays = uniqueDays(gitLog);

    console.log('\n--- Git Operations ---');
    console.log(`  Entries totali: ${gitLog.length}`);
    console.log(`  Commits: ${commits} | Pushes: ${pushes}`);
    console.log(`  Giorni attivi: ${gitDays.length}`);

    // --- Session log ---
    const sessionLog = parseLog(join(MEMORY, 'session-log.txt'));
    const sessionCloses = countByPattern(sessionLog, /Sessione chiusa/);
    const worklogWarnings = countByPattern(sessionLog, /WORKLOG/);
    const sessionDays = uniqueDays(sessionLog);

    console.log('\n--- Sessions ---');
    console.log(`  Sessioni chiuse: ${sessionCloses}`);
    console.log(`  Avvisi worklog non aggiornato: ${worklogWarnings}`);
    console.log(`  Giorni attivi: ${sessionDays.length}`);

    // --- Teams log ---
    const teamsLog = parseLog(join(MEMORY, 'teams-log.txt'));
    const teamsDays = uniqueDays(teamsLog);

    console.log('\n--- Agent Teams ---');
    console.log(`  Entries totali: ${teamsLog.length}`);
    console.log(`  Giorni attivi: ${teamsDays.length}`);

    // --- Riepilogo e segnali ---
    console.log('\n--- Segnali ---');
    const signals: string[] = [];

    if (misses > 0) {
        signals.push(`⚠️  ${misses} possible antiban miss — verificare se servono nuovi pattern in ANTIBAN_PATTERN`);
    }
    if (hardBlocks > 5 && antibanDays.length > 0) {
        const rate = (hardBlocks / antibanDays.length).toFixed(1);
        signals.push(`ℹ️  ${rate} hard blocks/giorno — se molti sono falsi positivi, valutare whitelist aggiuntive`);
    }
    if (worklogWarnings > 3) {
        signals.push(`⚠️  ${worklogWarnings} sessioni senza aggiornamento worklog — verificare disciplina di tracking`);
    }
    if (qualityLog.length > 0 && vitestRuns === 0) {
        signals.push(`⚠️  Nessun vitest registrato nei log — verificare che i test vengano eseguiti`);
    }

    if (signals.length === 0) {
        console.log('Nessun segnale critico rilevato ✅');
    } else {
        signals.forEach((s) => console.log(s));
    }

    console.log('');
    process.exit(0);
}

run();
