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

interface HookCommand {
    command?: unknown;
}

interface HookEntry {
    matcher?: unknown;
    hooks?: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getHookEntries(hooks: Record<string, unknown[]>, eventName: string): HookEntry[] {
    return (hooks[eventName] ?? []).filter(isRecord) as HookEntry[];
}

function getNestedCommands(entry: HookEntry): HookCommand[] {
    if (!Array.isArray(entry.hooks)) {
        return [];
    }
    return entry.hooks.filter(isRecord) as HookCommand[];
}

function getCommandText(command: HookCommand): string {
    return typeof command.command === 'string' ? command.command : '';
}

function getMatcher(entry: HookEntry): string {
    return typeof entry.matcher === 'string' ? entry.matcher : '';
}

function findEntryByCommand(entries: HookEntry[], commandPattern: string): HookEntry | undefined {
    return entries.find((entry) =>
        getNestedCommands(entry).some((hook) => getCommandText(hook).includes(commandPattern)),
    );
}

function readHookScript(scriptName: string): string | null {
    const scriptPath = join(homedir(), '.claude', 'hooks', scriptName);
    if (!existsSync(scriptPath)) {
        return null;
    }
    return readFileSync(scriptPath, 'utf8');
}

function checkPreToolUseAntiban(hooks: Record<string, unknown[]>): CheckResult {
    const pre = getHookEntries(hooks, 'PreToolUse');
    const antiban = findEntryByCommand(pre, 'pre-edit-antiban.ps1');
    if (!antiban) {
        return { name: 'PreToolUse antiban hook', passed: false, detail: 'Hook antiban mancante in PreToolUse.' };
    }

    const script = readHookScript('pre-edit-antiban.ps1');
    if (!script) {
        return {
            name: 'PreToolUse antiban hook',
            passed: false,
            detail: 'Script globale pre-edit-antiban.ps1 non trovato.',
        };
    }

    const usesPermissionDeny = /Write-HookDecision\s+-Decision\s+deny/i.test(script);
    const noExit2 = !/exit\s+2\b/i.test(script);
    if (!usesPermissionDeny) {
        return {
            name: 'PreToolUse antiban hook',
            passed: false,
            detail: 'Hook antiban trovato ma lo script non usa Write-HookDecision -Decision deny.',
        };
    }
    if (!noExit2) {
        return {
            name: 'PreToolUse antiban hook',
            passed: false,
            detail: 'Hook antiban usa ancora exit 2 nello script globale — rimuovere il bypass legacy.',
        };
    }
    return { name: 'PreToolUse antiban hook', passed: true, detail: 'permissionDecision deny + exit 0 ✅' };
}

function checkPostToolUseQuality(hooks: Record<string, unknown[]>): CheckResult {
    const post = getHookEntries(hooks, 'PostToolUse');
    const quality = findEntryByCommand(post, 'post-bash-quality-log.ps1');
    if (!quality) {
        return {
            name: 'PostToolUse quality hook',
            passed: false,
            detail: 'Hook qualità mancante in PostToolUse.',
        };
    }
    return { name: 'PostToolUse quality hook', passed: true, detail: 'post-bash-quality-log.ps1 presente ✅' };
}

function checkPreToolUseL1Gate(hooks: Record<string, unknown[]>): CheckResult {
    const pre = getHookEntries(hooks, 'PreToolUse');
    const l1Gate = findEntryByCommand(pre, 'pre-bash-l1-gate.ps1');
    if (!l1Gate) {
        return {
            name: 'PreToolUse L1 git-commit gate',
            passed: false,
            detail: 'Hook L1 su git commit mancante in PreToolUse.',
        };
    }
    return { name: 'PreToolUse L1 git-commit gate', passed: true, detail: 'pre-bash-l1-gate.ps1 presente ✅' };
}

function checkPreToolUseGitGate(hooks: Record<string, unknown[]>): CheckResult {
    const pre = getHookEntries(hooks, 'PreToolUse');
    const gitGate = findEntryByCommand(pre, 'pre-bash-git-gate.ps1');
    if (!gitGate) {
        return {
            name: 'PreToolUse git state gate',
            passed: false,
            detail: 'Hook git state gate mancante in PreToolUse.',
        };
    }
    return { name: 'PreToolUse git state gate', passed: true, detail: 'pre-bash-git-gate.ps1 presente ✅' };
}

function checkPostToolUseFileSize(hooks: Record<string, unknown[]>): CheckResult {
    const post = getHookEntries(hooks, 'PostToolUse');
    const fileSize = findEntryByCommand(post, 'file-size-check.ps1');
    if (!fileSize) {
        return {
            name: 'PostToolUse file-size-check hook',
            passed: false,
            detail: 'Hook file-size-check mancante — i file >300 righe non vengono loggati.',
        };
    }
    return { name: 'PostToolUse file-size-check hook', passed: true, detail: 'file-size-check.ps1 presente ✅' };
}

function checkPostToolUseGitAudit(hooks: Record<string, unknown[]>): CheckResult {
    const post = getHookEntries(hooks, 'PostToolUse');
    const gitAudit = findEntryByCommand(post, 'post-bash-git-audit.ps1');
    if (!gitAudit) {
        return {
            name: 'PostToolUse git audit hook',
            passed: false,
            detail: 'Hook post-bash-git-audit mancante in PostToolUse.',
        };
    }
    return { name: 'PostToolUse git audit hook', passed: true, detail: 'post-bash-git-audit.ps1 presente ✅' };
}

function checkStopHook(hooks: Record<string, unknown[]>): CheckResult {
    const stop = getHookEntries(hooks, 'Stop');
    const sessionLog = findEntryByCommand(stop, 'stop-session.ps1');
    if (!sessionLog) {
        return {
            name: 'Stop hook (session log)',
            passed: false,
            detail: 'Stop hook con session-log mancante.',
        };
    }
    return { name: 'Stop hook (session log)', passed: true, detail: 'session-log.txt presente ✅' };
}

function checkUserPromptSubmitRuntimeHook(hooks: Record<string, unknown[]>): CheckResult {
    const submit = getHookEntries(hooks, 'UserPromptSubmit');
    const runtimeBrief = findEntryByCommand(submit, 'inject-runtime-brief.ps1 -HookEventName UserPromptSubmit');
    if (!runtimeBrief) {
        return {
            name: 'UserPromptSubmit runtime-brief hook',
            passed: false,
            detail: 'Hook runtime brief mancante in UserPromptSubmit.',
        };
    }
    return {
        name: 'UserPromptSubmit runtime-brief hook',
        passed: true,
        detail: 'inject-runtime-brief.ps1 presente su UserPromptSubmit ✅',
    };
}

function checkUserPromptSubmitSkillRoutingHook(hooks: Record<string, unknown[]>): CheckResult {
    const submit = getHookEntries(hooks, 'UserPromptSubmit');
    const routingHook = findEntryByCommand(submit, 'skill-activation.ps1');
    if (!routingHook) {
        return {
            name: 'UserPromptSubmit skill-routing hook',
            passed: false,
            detail: 'Hook skill-activation.ps1 mancante in UserPromptSubmit.',
        };
    }
    return {
        name: 'UserPromptSubmit skill-routing hook',
        passed: true,
        detail: 'skill-activation.ps1 presente su UserPromptSubmit ✅',
    };
}

function checkPreCompactRuntimeHook(hooks: Record<string, unknown[]>): CheckResult {
    const compact = getHookEntries(hooks, 'PreCompact');
    const runtimeBrief = findEntryByCommand(compact, 'inject-runtime-brief.ps1 -HookEventName PreCompact');
    if (!runtimeBrief) {
        return {
            name: 'PreCompact runtime-brief hook',
            passed: false,
            detail: 'Hook runtime brief mancante in PreCompact.',
        };
    }
    return {
        name: 'PreCompact runtime-brief hook',
        passed: true,
        detail: 'inject-runtime-brief.ps1 presente su PreCompact ✅',
    };
}

function checkAntibanMatcherCoverage(hooks: Record<string, unknown[]>): CheckResult {
    const pre = getHookEntries(hooks, 'PreToolUse');
    const antiban = findEntryByCommand(pre, 'pre-edit-antiban.ps1');

    if (!antiban) {
        return { name: 'Antiban — copertura matcher', passed: false, detail: 'Hook non trovato.' };
    }
    const matcher = getMatcher(antiban);
    const coversEditWrite =
        matcher.includes('Edit') &&
        matcher.includes('Write') &&
        (matcher.includes('MultiEdit') || matcher.includes('Edit|Write'));
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

function checkSessionStartHook(hooks: Record<string, unknown[]>): CheckResult {
    const start = getHookEntries(hooks, 'SessionStart');
    const session = findEntryByCommand(start, 'session-start.ps1');
    if (!session) {
        return {
            name: 'SessionStart hook',
            passed: false,
            detail: 'Hook session-start.ps1 mancante in SessionStart.',
        };
    }
    return { name: 'SessionStart hook', passed: true, detail: 'session-start.ps1 presente ✅' };
}

function checkPostToolUseViolations(hooks: Record<string, unknown[]>): CheckResult {
    const post = getHookEntries(hooks, 'PostToolUse');
    const violations = findEntryByCommand(post, 'post-edit-antiban-audit.ps1');
    if (!violations) {
        return {
            name: 'PostToolUse violations tracker hook',
            passed: false,
            detail: 'Hook post-edit-antiban-audit.ps1 mancante in PostToolUse.',
        };
    }
    return {
        name: 'PostToolUse violations tracker hook',
        passed: true,
        detail: 'post-edit-antiban-audit.ps1 presente ✅',
    };
}

function checkTeammateEventHooks(hooks: Record<string, unknown[]>): CheckResult {
    const events = ['TeammateIdle', 'TaskCreated', 'TaskCompleted'] as const;
    const missing: string[] = [];
    for (const event of events) {
        const entries = getHookEntries(hooks, event);
        const found = findEntryByCommand(entries, 'teammate-event.ps1');
        if (!found) missing.push(event);
    }
    if (missing.length > 0) {
        return {
            name: 'Agent team event hooks',
            passed: false,
            detail: `Hook teammate-event.ps1 mancante per: ${missing.join(', ')}`,
        };
    }
    return {
        name: 'Agent team event hooks',
        passed: true,
        detail: 'TeammateIdle/TaskCreated/TaskCompleted presenti ✅',
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
        checkUserPromptSubmitRuntimeHook(hooks),
        checkUserPromptSubmitSkillRoutingHook(hooks),
        checkPreToolUseAntiban(hooks),
        checkAntibanMatcherCoverage(hooks),
        checkPreToolUseL1Gate(hooks),
        checkPreToolUseGitGate(hooks),
        checkPreCompactRuntimeHook(hooks),
        checkPostToolUseQuality(hooks),
        checkPostToolUseGitAudit(hooks),
        checkPostToolUseFileSize(hooks),
        checkPostToolUseViolations(hooks),
        checkStopHook(hooks),
        checkSessionStartHook(hooks),
        checkTeammateEventHooks(hooks),
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
