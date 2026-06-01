/**
 * aiReasoningHardeningAudit.ts
 *
 * Verifica che il sistema AI di ragionamento/orchestrazione sia esplicito,
 * auditabile e coperto almeno da hook Claude + parity minima Codex.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

interface CheckResult {
    area: string;
    name: string;
    passed: boolean;
    detail: string;
}

interface HookCommand {
    command?: unknown;
}

interface HookEntry {
    hooks?: unknown;
}

interface CodexHookConfig {
    hooks?: Record<string, unknown>;
}

type Scope = 'all' | 'orchestrator' | 'reasoning' | 'hook-coverage' | 'continuation' | 'codex';

function readText(path: string): string | null {
    if (!existsSync(path)) {
        return null;
    }
    return readFileSync(path, 'utf8');
}

function readJson<T>(path: string): T | null {
    const text = readText(path);
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function missingSnippets(text: string | null, snippets: string[]): string[] {
    if (!text) {
        return snippets;
    }
    return snippets.filter((snippet) => !text.includes(snippet));
}

function getHookEntries(settings: Record<string, unknown>, eventName: string): HookEntry[] {
    const hooks = isRecord(settings.hooks) ? settings.hooks : {};
    const eventHooks = hooks[eventName];
    if (!Array.isArray(eventHooks)) {
        return [];
    }
    return eventHooks.filter(isRecord) as HookEntry[];
}

function getNestedCommands(entry: HookEntry): HookCommand[] {
    if (!Array.isArray(entry.hooks)) {
        return [];
    }
    return entry.hooks.filter(isRecord) as HookCommand[];
}

function eventHasCommand(settings: Record<string, unknown>, eventName: string, commandPart: string): boolean {
    return getHookEntries(settings, eventName).some((entry) =>
        getNestedCommands(entry).some((hook) => typeof hook.command === 'string' && hook.command.includes(commandPart)),
    );
}

function commandFileExists(command: string): boolean {
    const match = command.match(/-File\s+"?([^"\r\n]+?\.ps1)"?/i);
    if (!match) {
        return false;
    }
    return existsSync(match[1].replaceAll('/', '\\'));
}

function collectCodexCommands(config: CodexHookConfig, eventName: string): string[] {
    const eventHooks = config.hooks?.[eventName];
    if (!Array.isArray(eventHooks)) {
        return [];
    }

    const commands: string[] = [];
    for (const entry of eventHooks) {
        if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
            continue;
        }
        for (const hook of entry.hooks) {
            if (isRecord(hook) && typeof hook.command === 'string') {
                commands.push(hook.command);
            }
        }
    }
    return commands;
}

function checkFileContains(area: string, name: string, path: string, snippets: string[]): CheckResult {
    const missing = missingSnippets(readText(path), snippets);
    if (missing.length > 0) {
        return {
            area,
            name,
            passed: false,
            detail: `${path} incompleto. Mancano: ${missing.join(' | ')}`,
        };
    }

    return {
        area,
        name,
        passed: true,
        detail: `${path} contiene i requisiti minimi.`,
    };
}

function checkOrchestratorContract(): CheckResult {
    return checkFileContains(
        'Contratto',
        'AI_ORCHESTRATOR_CONTRACT completo',
        resolve('docs', 'tracking', 'AI_ORCHESTRATOR_CONTRACT.md'),
        [
            '## Scope',
            '## Trigger',
            '## Contratto Operativo',
            '## Traccia Operativa Osservabile',
            '## Hook Coverage',
            '## Non Goals',
            'intento reale',
            'Input utente come ipotesi',
            'Esempi come pattern',
            'Decomposizione ricorsiva',
            'Root cause',
            'Fonte di verita',
            'Capability routing automatico',
            'Modello e ambiente',
            'Blast radius L2-L9',
            'file diretti',
            'file indiretti',
            'Cross-domain per ogni file',
            'Truthful completion',
            'SessionStart',
            'UserPromptSubmit',
            'PreToolUse',
            'PostToolUse',
            'PreCompact',
            'Stop',
            'Codex',
        ],
    );
}

function checkReasoningTrace(): CheckResult {
    const files: Array<[string, string[]]> = [
        [
            resolve('docs', 'AI_RUNTIME_BRIEF.md'),
            [
                'AI_ORCHESTRATOR_CONTRACT.md',
                'Orchestrator Layer',
                'Input utente come ipotesi',
                'Esempi come pattern',
                'decomposizione ricorsiva',
                'fonte di verita',
                'skill, MCP, plugin, hook, script, audit, subagent, loop o workflow n8n',
                'file diretto',
                'file indiretti',
                'Truthful completion',
            ],
        ],
        [
            resolve('AGENTS.md'),
            [
                'docs/tracking/AI_ORCHESTRATOR_CONTRACT.md',
                'Procedura cognitiva ripetibile',
                'Regola non dimenticabile',
                'Controllo deterministico',
                'Automazione durevole',
            ],
        ],
        [
            resolve('docs', 'tracking', 'README.md'),
            ['AI_ORCHESTRATOR_CONTRACT.md', 'audit:ai-reasoning-hardening', 'audit:codex-hook-parity'],
        ],
    ];

    const missing: string[] = [];
    for (const [path, snippets] of files) {
        const fileMissing = missingSnippets(readText(path), snippets);
        missing.push(...fileMissing.map((snippet) => `${path} -> ${snippet}`));
    }

    if (missing.length > 0) {
        return {
            area: 'Ragionamento',
            name: 'Traccia operativa collegata ai canonici',
            passed: false,
            detail: `Collegamenti mancanti: ${missing.join(' | ')}`,
        };
    }

    return {
        area: 'Ragionamento',
        name: 'Traccia operativa collegata ai canonici',
        passed: true,
        detail: 'Runtime brief, AGENTS e tracking README puntano al contratto orchestrator.',
    };
}

function checkClaudeHookCoverage(): CheckResult {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const settings = readJson<Record<string, unknown>>(settingsPath);
    if (!settings) {
        return {
            area: 'Hook Claude',
            name: 'Copertura semantica hook Claude',
            passed: false,
            detail: `${settingsPath} non trovato o JSON non valido.`,
        };
    }

    const required: Array<[string, string]> = [
        ['SessionStart', 'session-start.ps1'],
        ['SessionStart', 'session-start-continuation.ps1'],
        ['UserPromptSubmit', 'inject-runtime-brief.ps1'],
        ['UserPromptSubmit', 'skill-activation.ps1'],
        ['UserPromptSubmit', 'pre-edit-verify-intent.ps1'],
        ['UserPromptSubmit', 'user-prompt-model-suggestion.ps1'],
        ['PreToolUse', 'pre-edit-best-practice.ps1'],
        ['PreToolUse', 'pre-edit-secrets.ps1'],
        ['PreToolUse', 'pre-bash-l1-gate.ps1'],
        ['PostToolUse', 'post-edit-verify-checklist.ps1'],
        ['PostToolUse', 'post-edit-codebase-hygiene.ps1'],
        ['PostToolUse', 'post-websearch-log.ps1'],
        ['PreCompact', 'pre-compact-handoff.ps1'],
        ['Stop', 'pre-stop-commit-gate.ps1'],
        ['Stop', 'stop-proactive-next-step.ps1'],
        ['Stop', 'stop-session.ps1'],
    ];

    const missing = required
        .filter(([eventName, commandPart]) => !eventHasCommand(settings, eventName, commandPart))
        .map(([eventName, commandPart]) => `${eventName}:${commandPart}`);

    if (missing.length > 0) {
        return {
            area: 'Hook Claude',
            name: 'Copertura semantica hook Claude',
            passed: false,
            detail: `Hook mancanti: ${missing.join(', ')}`,
        };
    }

    return {
        area: 'Hook Claude',
        name: 'Copertura semantica hook Claude',
        passed: true,
        detail: 'SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact e Stop coperti.',
    };
}

function checkHookPlanDoc(): CheckResult {
    return checkFileContains(
        'Hook Claude',
        'Piano hook documenta coverage',
        resolve('docs', 'tracking', 'AI_HOOK_ENFORCEMENT_PLAN.md'),
        ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'Stop', 'Codex'],
    );
}

function checkContinuationCompleteness(): CheckResult {
    const path = resolve('.claude', 'CONTINUATION.md');
    const text = readText(path);
    const required = [
        '## PROBLEMA CHE STAVAMO RISOLVENDO',
        '## COSA E STATO COMPLETATO',
        '## DECISIONI CHIAVE',
        '## DA NON RIPETERE',
        '## STATO TECNICO ESATTO',
        '## PROSSIMO PASSO ESATTO',
        '## CORREZIONI UTENTE QUESTA SESSIONE',
        '## TASK APERTI',
    ];

    const missing = missingSnippets(text, required);
    const hasPlaceholder = text?.includes('TODO: [AI:') ?? true;
    if (missing.length > 0 || hasPlaceholder) {
        const details = [...missing];
        if (hasPlaceholder) {
            details.push('placeholder TODO: [AI: ancora presente');
        }
        return {
            area: 'Continuation',
            name: 'Continuation non contiene placeholder',
            passed: false,
            detail: `${path} incompleto. ${details.join(' | ')}`,
        };
    }

    return {
        area: 'Continuation',
        name: 'Continuation non contiene placeholder',
        passed: true,
        detail: 'Continuation ha sezioni minime e nessun placeholder AI.',
    };
}

function checkCodexHookParity(): CheckResult {
    const configPath = join(homedir(), '.codex', 'config.toml');
    const configText = readText(configPath);
    const hooksEnabled = /\[features\][\s\S]*?\bhooks\s*=\s*true\b/.test(configText ?? '');

    const hooksPath = resolve('.codex', 'hooks.json');
    const hooksConfig = readJson<CodexHookConfig>(hooksPath);
    const requiredEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
    const missing: string[] = [];

    if (!hooksEnabled) {
        missing.push(`${configPath} -> [features].hooks = true`);
    }
    if (!hooksConfig?.hooks) {
        missing.push(`${hooksPath} -> hooks object`);
    } else {
        for (const eventName of requiredEvents) {
            const commands = collectCodexCommands(hooksConfig, eventName);
            if (commands.length === 0) {
                missing.push(`${hooksPath} -> ${eventName}`);
                continue;
            }
            if (!commands.every(commandFileExists)) {
                missing.push(`${hooksPath} -> ${eventName} command file inesistente`);
            }
        }
    }

    if (missing.length > 0) {
        return {
            area: 'Codex parity',
            name: 'Hook Codex minimi attivi',
            passed: false,
            detail: `Mancanze: ${missing.join(' | ')}`,
        };
    }

    return {
        area: 'Codex parity',
        name: 'Hook Codex minimi attivi',
        passed: true,
        detail: 'Config Codex abilita hooks e .codex/hooks.json copre gli eventi minimi.',
    };
}

/**
 * Verifica la COPERTURA REALE delle capability critiche in Codex, non solo gli eventi minimi.
 * I gap critici della PARITY_MATRIX (PreToolUse Edit, post-edit hygiene, sync Obsidian,
 * principi comportamentali) devono essere coperti da hook reali con contenuto verificato.
 */
function checkCodexCapabilityCoverage(): CheckResult {
    const hooksPath = resolve('.codex', 'hooks.json');
    const hooksConfig = readJson<CodexHookConfig>(hooksPath);
    const missing: string[] = [];

    // 1. PreToolUse Edit gate (chiude GAP-2 anti-ban/secrets su edit)
    const preToolCommands = hooksConfig ? collectCodexCommands(hooksConfig, 'PreToolUse') : [];
    if (!preToolCommands.some((c) => c.includes('codex-edit-gate'))) {
        missing.push('PreToolUse -> codex-edit-gate.ps1 (anti-ban + secrets su Edit)');
    }

    // 2. PostToolUse Edit hygiene (chiude GAP-4 size + hygiene + verify)
    const postToolCommands = hooksConfig ? collectCodexCommands(hooksConfig, 'PostToolUse') : [];
    if (!postToolCommands.some((c) => c.includes('codex-post-edit'))) {
        missing.push('PostToolUse -> codex-post-edit.ps1 (size + hygiene + verify L2-L7)');
    }

    // 3. Edit gate file deve esistere E contenere i 3 gate
    const editGatePath = resolve('.codex', 'hooks', 'codex-edit-gate.ps1');
    const editGateMissing = missingSnippets(readText(editGatePath), ['ANTI-BAN', 'SECRETS', 'BEST-PRACTICE']);
    if (editGateMissing.length > 0) {
        missing.push(`codex-edit-gate.ps1 incompleto: mancano ${editGateMissing.join(', ')}`);
    }

    // 4. Runtime context deve iniettare i principi comportamentali (parità con skill-activation Claude)
    const runtimeCtxPath = resolve('.codex', 'hooks', 'codex-runtime-context.ps1');
    const ctxMissing = missingSnippets(readText(runtimeCtxPath), [
        'MINDSET DIPENDENTE',
        'SPINGITI OLTRE',
        'CODEX_MEMORY',
        'CODEX_PARITY',
    ]);
    if (ctxMissing.length > 0) {
        missing.push(`codex-runtime-context.ps1 incompleto: mancano ${ctxMissing.join(', ')}`);
    }

    // 5. Stop check deve fare sync Obsidian (chiude GAP-5)
    const stopCheckPath = resolve('.codex', 'hooks', 'codex-stop-check.ps1');
    const stopMissing = missingSnippets(readText(stopCheckPath), ['sync-memory-to-obsidian', 'PROACTIVE_NEXT_STEP']);
    if (stopMissing.length > 0) {
        missing.push(`codex-stop-check.ps1 incompleto: mancano ${stopMissing.join(', ')}`);
    }

    // 6. PARITY_MATRIX.md deve esistere e documentare i gap
    const parityPath = resolve('docs', 'PARITY_MATRIX.md');
    const parityMissing = missingSnippets(readText(parityPath), ['GAP-1', 'GAP-2', 'Quando usare cosa']);
    if (parityMissing.length > 0) {
        missing.push(`PARITY_MATRIX.md incompleto: mancano ${parityMissing.join(', ')}`);
    }

    if (missing.length > 0) {
        return {
            area: 'Codex parity',
            name: 'Copertura capability Codex (gap critici PARITY_MATRIX)',
            passed: false,
            detail: `Gap non coperti: ${missing.join(' | ')}`,
        };
    }

    return {
        area: 'Codex parity',
        name: 'Copertura capability Codex (gap critici PARITY_MATRIX)',
        passed: true,
        detail: 'Edit gate, post-edit hygiene, principi comportamentali, sync Obsidian e parity matrix coperti.',
    };
}

function parseScope(): Scope {
    const scopeArg = process.argv.find((arg) => arg.startsWith('--scope='));
    const value = scopeArg?.slice('--scope='.length) ?? 'all';
    const validScopes: Scope[] = ['all', 'orchestrator', 'reasoning', 'hook-coverage', 'continuation', 'codex'];
    if (validScopes.includes(value as Scope)) {
        return value as Scope;
    }
    throw new Error(`Scope non valido: ${value}. Valori: ${validScopes.join(', ')}`);
}

function checksForScope(scope: Scope): CheckResult[] {
    const checks: CheckResult[] = [];

    if (scope === 'all' || scope === 'orchestrator') {
        checks.push(checkOrchestratorContract());
    }
    if (scope === 'all' || scope === 'reasoning') {
        checks.push(checkReasoningTrace());
    }
    if (scope === 'all' || scope === 'hook-coverage') {
        checks.push(checkClaudeHookCoverage(), checkHookPlanDoc());
    }
    if (scope === 'all' || scope === 'continuation') {
        checks.push(checkContinuationCompleteness());
    }
    if (scope === 'all' || scope === 'codex') {
        checks.push(checkCodexHookParity(), checkCodexCapabilityCoverage());
    }

    return checks;
}

function run(): void {
    const scope = parseScope();
    const checks = checksForScope(scope);
    let currentArea = '';
    let allPassed = true;

    console.log(`\n=== AI Reasoning Hardening Audit (${scope}) ===\n`);
    for (const check of checks) {
        if (check.area !== currentArea) {
            currentArea = check.area;
            console.log(`--- ${currentArea} ---`);
        }
        const mark = check.passed ? '[OK]' : '[FAIL]';
        console.log(`${mark} ${check.name}`);
        if (!check.passed) {
            console.log(`  ${check.detail}`);
            allPassed = false;
        }
    }

    const passed = checks.filter((check) => check.passed).length;
    console.log(`\n${passed}/${checks.length} check passati.\n`);

    if (!allPassed) {
        process.exit(1);
    }
}

run();
