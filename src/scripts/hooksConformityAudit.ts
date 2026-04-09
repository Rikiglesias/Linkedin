/**
 * hooksConformityAudit.ts — Verifica conformità hook critici Claude Code
 *
 * Controlla che ~/.claude/settings.json contenga tutti gli hook obbligatori
 * e che usino i pattern corretti (permissionDecision deny, non exit 2).
 *
 * Uso:
 *   npx ts-node src/scripts/hooksConformityAudit.ts
 *   npm run audit:hooks
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

function readSettings(): Record<string, unknown> {
    const path = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(path)) {
        throw new Error(`settings.json non trovato: ${path}`);
    }
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function getHooks(settings: Record<string, unknown>): Record<string, unknown[]> {
    return (settings.hooks as Record<string, unknown[]>) ?? {};
}

function stringify(v: unknown): string {
    return JSON.stringify(v);
}

function checkPreToolUseAntiban(hooks: Record<string, unknown[]>): CheckResult {
    const pre = hooks['PreToolUse'] ?? [];
    const antiban = pre.find((h) => {
        const s = stringify(h);
        return s.includes('browser') && s.includes('stealth') && s.includes('fingerprint');
    });
    if (!antiban) {
        return { name: 'PreToolUse antiban hook', passed: false, detail: 'Hook antiban mancante in PreToolUse.' };
    }
    const raw = stringify(antiban);
    const usesPerissionDeny = raw.includes('permissionDecision') && raw.includes('deny');
    const noExit2 = !raw.includes('exit 2');
    if (!usesPerissionDeny) {
        return {
            name: 'PreToolUse antiban hook',
            passed: false,
            detail: 'Hook antiban trovato ma non usa permissionDecision deny — usa exit 2 (bypass-able).',
        };
    }
    if (!noExit2) {
        return {
            name: 'PreToolUse antiban hook',
            passed: false,
            detail: 'Hook antiban usa ancora exit 2 insieme a permissionDecision — rimuovere exit 2',
        };
    }
    return { name: 'PreToolUse antiban hook', passed: true, detail: 'permissionDecision deny + exit 0 ✅' };
}

function checkPostToolUseQuality(hooks: Record<string, unknown[]>): CheckResult {
    const post = hooks['PostToolUse'] ?? [];
    const quality = post.find((h) => {
        const s = stringify(h);
        return s.includes('quality-hook-log') || (s.includes('npm run') && s.includes('tsc'));
    });
    if (!quality) {
        return {
            name: 'PostToolUse quality hook',
            passed: false,
            detail: 'Hook qualità mancante in PostToolUse.',
        };
    }
    return { name: 'PostToolUse quality hook', passed: true, detail: 'quality-hook-log presente ✅' };
}

function checkPostToolUseFileSize(hooks: Record<string, unknown[]>): CheckResult {
    const post = hooks['PostToolUse'] ?? [];
    const fileSize = post.find((h) => {
        const s = stringify(h);
        return s.includes('file-size-check');
    });
    if (!fileSize) {
        return {
            name: 'PostToolUse file-size-check hook',
            passed: false,
            detail: 'Hook file-size-check mancante — i file >300 righe non vengono loggati.',
        };
    }
    return { name: 'PostToolUse file-size-check hook', passed: true, detail: 'file-size-check.ps1 presente ✅' };
}

function checkStopHook(hooks: Record<string, unknown[]>): CheckResult {
    const stop = hooks['Stop'] ?? [];
    const sessionLog = stop.find((h) => {
        const s = stringify(h);
        return s.includes('session-log');
    });
    if (!sessionLog) {
        return {
            name: 'Stop hook (session log)',
            passed: false,
            detail: 'Stop hook con session-log mancante.',
        };
    }
    return { name: 'Stop hook (session log)', passed: true, detail: 'session-log.txt presente ✅' };
}

function checkAntibanMatcherCoverage(hooks: Record<string, unknown[]>): CheckResult {
    const pre = hooks['PreToolUse'] ?? [];
    const antiban = pre.find((h) => {
        const s = stringify(h);
        return s.includes('browser') && s.includes('stealth');
    }) as Record<string, unknown> | undefined;

    if (!antiban) {
        return { name: 'Antiban — copertura matcher', passed: false, detail: 'Hook non trovato.' };
    }
    const matcher = (antiban.matcher as string) ?? '';
    const coversEditWrite = matcher.includes('Edit') || matcher.includes('Write');
    if (!coversEditWrite) {
        return {
            name: 'Antiban — copertura matcher',
            passed: false,
            detail: `Matcher "${matcher}" non copre Edit|Write.`,
        };
    }
    return {
        name: 'Antiban — copertura matcher',
        passed: true,
        detail: `Matcher "${matcher}" copre modifiche file ✅`,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run(): void {
    console.log('\n=== Hooks Conformity Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    let settings: Record<string, unknown>;
    try {
        settings = readSettings();
    } catch (err) {
        console.error('ERRORE:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    const hooks = getHooks(settings);

    const checks: CheckResult[] = [
        checkPreToolUseAntiban(hooks),
        checkAntibanMatcherCoverage(hooks),
        checkPostToolUseQuality(hooks),
        checkPostToolUseFileSize(hooks),
        checkStopHook(hooks),
    ];

    let allPassed = true;
    for (const c of checks) {
        const icon = c.passed ? '✅' : '❌';
        console.log(`${icon} ${c.name}`);
        if (!c.passed) {
            console.log(`   → ${c.detail}`);
            allPassed = false;
        }
    }

    const passed = checks.filter((c) => c.passed).length;
    console.log(`\n--- ${passed}/${checks.length} check passati ---`);

    if (allPassed) {
        console.log('✅ Tutti gli hook critici sono conformi.\n');
        process.exit(0);
    } else {
        const failed = checks.filter((c) => !c.passed);
        console.log(`\n❌ ${failed.length} problemi rilevati:`);
        failed.forEach((c) => console.log(`  - ${c.name}: ${c.detail}`));
        console.log('\nCorreggi in ~/.claude/settings.json → sezione hooks.\n');
        process.exit(1);
    }
}

run();
