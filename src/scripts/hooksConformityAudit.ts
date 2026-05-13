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

interface ExpectedHookSpec {
    eventName: string;
    matcherIncludes?: string[];
    commandParts: string[];
    label: string;
    requiresUnifiedRouter?: boolean;
}

const UNIFIED_ROUTER_BASE_URL = 'http://127.0.0.1:4319';

function isUnifiedRouterActive(settings: Record<string, unknown>): boolean {
    const env = (settings.env as Record<string, unknown> | undefined) ?? {};
    return env.ANTHROPIC_BASE_URL === UNIFIED_ROUTER_BASE_URL;
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

function findEntryByCommandParts(entries: HookEntry[], commandParts: string[]): HookEntry | undefined {
    return entries.find((entry) =>
        getNestedCommands(entry).some((hook) => {
            const command = getCommandText(hook);
            return commandParts.every((part) => command.includes(part));
        }),
    );
}

function readHookScript(scriptName: string): string | null {
    const scriptPath = join(homedir(), '.claude', 'hooks', scriptName);
    if (!existsSync(scriptPath)) {
        return null;
    }
    return readFileSync(scriptPath, 'utf8');
}

function getAllHookCommands(hooks: Record<string, unknown[]>): string[] {
    return Object.values(hooks)
        .flatMap((entries) => entries.filter(isRecord) as HookEntry[])
        .flatMap((entry) => getNestedCommands(entry))
        .map(getCommandText)
        .filter((command) => command.length > 0);
}

function commandReferencesPath(command: string): string | null {
    const fileMatch = command.match(/(?:-File|node)\s+("?)([A-Za-z]:[^\s"]+)\1/i);
    if (!fileMatch) {
        return null;
    }
    return fileMatch[2].replace(/\//g, '\\');
}

function checkConfiguredCommandTargetsExist(hooks: Record<string, unknown[]>): CheckResult {
    const missing = getAllHookCommands(hooks)
        .map((command) => commandReferencesPath(command))
        .filter((path): path is string => path !== null)
        .filter((path) => !existsSync(path));

    if (missing.length > 0) {
        return {
            name: 'Tutti gli hook configurati puntano a file esistenti',
            passed: false,
            detail: `Target mancanti: ${[...new Set(missing)].join(', ')}`,
        };
    }

    return {
        name: 'Tutti gli hook configurati puntano a file esistenti',
        passed: true,
        detail: `${getAllHookCommands(hooks).length} comandi hook configurati hanno target validi ✅`,
    };
}

function checkExpectedHooksConfigured(hooks: Record<string, unknown[]>): CheckResult {
    const expected: ExpectedHookSpec[] = [
        { eventName: 'PreToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['pre-edit-antiban.ps1'], label: 'pre-edit-antiban' },
        { eventName: 'PreToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['pre-edit-secrets.ps1'], label: 'pre-edit-secrets' },
        { eventName: 'PreToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['pre-edit-best-practice.ps1'], label: 'pre-edit-best-practice' },
        { eventName: 'PreToolUse', matcherIncludes: ['Bash'], commandParts: ['pre-bash-l1-gate.ps1'], label: 'pre-bash-l1-gate' },
        { eventName: 'PreToolUse', matcherIncludes: ['Bash'], commandParts: ['pre-bash-git-gate.ps1'], label: 'pre-bash-git-gate' },
        { eventName: 'PreToolUse', matcherIncludes: ['mcp__.*'], commandParts: ['pre-mcp-guard.ps1'], label: 'pre-mcp-guard' },
        { eventName: 'SessionStart', commandParts: ['ensure-claude-model-router.ps1'], label: 'ensure router session-start', requiresUnifiedRouter: true },
        { eventName: 'SessionStart', commandParts: ['merge-canonical-settings.mjs'], label: 'merge canonical settings' },
        { eventName: 'SessionStart', commandParts: ['session-start.ps1'], label: 'session-start' },
        { eventName: 'SessionStart', commandParts: ['session-start-continuation.ps1'], label: 'session-start-continuation' },
        { eventName: 'UserPromptSubmit', commandParts: ['ensure-claude-model-router.ps1'], label: 'ensure router prompt', requiresUnifiedRouter: true },
        { eventName: 'UserPromptSubmit', commandParts: ['inject-runtime-brief.ps1', 'UserPromptSubmit'], label: 'runtime brief prompt' },
        { eventName: 'UserPromptSubmit', commandParts: ['skill-activation.ps1'], label: 'skill activation' },
        { eventName: 'UserPromptSubmit', commandParts: ['multi-file-recap-check.ps1'], label: 'multi-file recap' },
        { eventName: 'UserPromptSubmit', commandParts: ['pre-edit-verify-intent.ps1'], label: 'verify intent' },
        { eventName: 'UserPromptSubmit', commandParts: ['user-prompt-commit-gate.ps1'], label: 'pending commit gate' },
        { eventName: 'UserPromptSubmit', commandParts: ['user-prompt-model-suggestion.ps1'], label: 'model suggestion' },
        { eventName: 'PreCompact', commandParts: ['inject-runtime-brief.ps1', 'PreCompact'], label: 'runtime brief compact' },
        { eventName: 'PreCompact', commandParts: ['pre-compact-handoff.ps1'], label: 'pre-compact handoff' },
        { eventName: 'Stop', commandParts: ['stop-session.ps1'], label: 'stop session' },
        { eventName: 'Stop', commandParts: ['pre-stop-commit-gate.ps1'], label: 'stop commit gate' },
        { eventName: 'Stop', commandParts: ['stop-proactive-next-step.ps1'], label: 'stop proactive next step' },
        { eventName: 'PostToolUse', matcherIncludes: ['Bash'], commandParts: ['post-bash-quality-log.ps1'], label: 'quality log' },
        { eventName: 'PostToolUse', matcherIncludes: ['Bash'], commandParts: ['post-bash-git-audit.ps1'], label: 'git audit log' },
        { eventName: 'PostToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['file-size-check.ps1'], label: 'file size check' },
        { eventName: 'PostToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['post-edit-antiban-audit.ps1'], label: 'antiban post audit' },
        { eventName: 'PostToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['post-edit-request-action.ps1'], label: 'request action' },
        { eventName: 'PostToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['post-edit-verify-checklist.ps1'], label: 'post edit L2-L6 checklist' },
        { eventName: 'PostToolUse', matcherIncludes: ['Edit', 'Write', 'MultiEdit'], commandParts: ['post-edit-codebase-hygiene.ps1'], label: 'post edit codebase hygiene' },
        { eventName: 'PostToolUse', matcherIncludes: ['WebSearch'], commandParts: ['post-websearch-log.ps1'], label: 'web search log' },
        { eventName: 'SubagentStop', commandParts: ['subagent-stop.ps1'], label: 'subagent stop' },
        { eventName: 'TeammateIdle', commandParts: ['teammate-event.ps1'], label: 'teammate idle' },
        { eventName: 'TaskCreated', commandParts: ['teammate-event.ps1'], label: 'task created' },
        { eventName: 'TaskCompleted', commandParts: ['teammate-event.ps1'], label: 'task completed' },
    ];

    const unifiedRouterActive = isUnifiedRouterActive(readSettings());
    const applicable = expected.filter((spec) => !spec.requiresUnifiedRouter || unifiedRouterActive);

    const missing = applicable.filter((spec) => {
        const entries = getHookEntries(hooks, spec.eventName);
        const matchingEntry = findEntryByCommandParts(entries, spec.commandParts);
        if (!matchingEntry) {
            return true;
        }
        if (!spec.matcherIncludes || spec.matcherIncludes.length === 0) {
            return false;
        }
        const matcher = getMatcher(matchingEntry);
        return spec.matcherIncludes.some((part) => !matcher.includes(part));
    });

    if (missing.length > 0) {
        return {
            name: 'Copertura completa hook attivi',
            passed: false,
            detail: `Hook mancanti o matcher errato: ${missing.map((spec) => `${spec.eventName}:${spec.label}`).join(', ')}`,
        };
    }

    return {
        name: 'Copertura completa hook attivi',
        passed: true,
        detail: `${expected.length} hook/config command attesi sono presenti con evento e matcher corretti ✅`,
    };
}

function checkPostEditRequestActionSafety(): CheckResult {
    const script = readHookScript('post-edit-request-action.ps1');
    if (!script) {
        return {
            name: 'Post-edit request action sicuro',
            passed: false,
            detail: 'Script post-edit-request-action.ps1 non trovato.',
        };
    }

    const executableScript = script
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

    const forbidden = [
        { label: 'git add .', pattern: /git\s+-C\s+\$cwd\s+add\s+\./i },
        { label: '--no-verify', pattern: /--no-verify/i },
    ].filter((entry) => entry.pattern.test(executableScript));

    const required = [
        'audit:git-automation:strict:commit',
        'audit:git-automation:strict:push',
        'post-modifiche',
    ].filter((snippet) => !script.includes(snippet));

    if (forbidden.length > 0 || required.length > 0) {
        const details = [
            ...forbidden.map((entry) => `vietato: ${entry.label}`),
            ...required.map((snippet) => `manca: ${snippet}`),
        ];
        return {
            name: 'Post-edit request action sicuro',
            passed: false,
            detail: details.join(', '),
        };
    }

    return {
        name: 'Post-edit request action sicuro',
        passed: true,
        detail: 'Niente git add cieco, niente --no-verify, gate post-modifiche + git audit richiesti ✅',
    };
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
    const proactiveNextStep = findEntryByCommand(stop, 'stop-proactive-next-step.ps1');
    if (!sessionLog) {
        return {
            name: 'Stop hook (session log)',
            passed: false,
            detail: 'Stop hook con session-log mancante.',
        };
    }
    if (!proactiveNextStep) {
        return {
            name: 'Stop hook (session log + continuita)',
            passed: false,
            detail: 'Stop hook stop-proactive-next-step.ps1 mancante.',
        };
    }
    return {
        name: 'Stop hook (session log + continuita)',
        passed: true,
        detail: 'session-log + PROACTIVE_NEXT_STEP_GATE presenti ✅',
    };
}

function checkUserPromptSubmitRuntimeHook(hooks: Record<string, unknown[]>): CheckResult {
    const submit = getHookEntries(hooks, 'UserPromptSubmit');
    const runtimeBrief = findEntryByCommandParts(submit, ['inject-runtime-brief.ps1', 'UserPromptSubmit']);
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
    const runtimeBrief = findEntryByCommandParts(compact, ['inject-runtime-brief.ps1', 'PreCompact']);
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
        checkConfiguredCommandTargetsExist(hooks),
        checkExpectedHooksConfigured(hooks),
        checkPostEditRequestActionSafety(),
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
