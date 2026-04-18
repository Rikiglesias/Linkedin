/**
 * aiControlPlaneAudit.ts — Verifica allineamento tra canonici repo e control plane AI globale
 *
 * Controlla che:
 * - i file canonici del repo dichiarino davvero le regole chiave della fase A
 * - il control plane globale Claude sia allineato all'orchestrazione cognitiva contestuale
 * - gli hook e le skill critiche esistano e contengano i requisiti minimi promessi dai documenti
 *
 * Uso:
 *   npx ts-node src/scripts/aiControlPlaneAudit.ts
 *   npm run audit:ai-control-plane
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

interface PackageJsonShape {
    scripts?: Record<string, string>;
}

interface HookCommand {
    command?: unknown;
}

interface HookEntry {
    hooks?: unknown;
}

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
    return JSON.parse(text) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function findHookCommand(settings: Record<string, unknown>, eventName: string, commandPattern: string): boolean {
    return getHookEntries(settings, eventName).some((entry) =>
        getNestedCommands(entry).some(
            (hook) => typeof hook.command === 'string' && hook.command.includes(commandPattern),
        ),
    );
}

function missingSnippets(text: string | null, snippets: string[]): string[] {
    if (!text) {
        return snippets;
    }
    return snippets.filter((snippet) => !text.includes(snippet));
}

function formatMissing(label: string, missing: string[]): string {
    return `${label} mancante o incompleto. Frammenti assenti: ${missing.join(' | ')}`;
}

function checkRepoAgents(): CheckResult {
    const path = resolve('AGENTS.md');
    const required = [
        "## Fonte di verita' e strumento corretto",
        '## Gap di capability e promozione strutturale',
        '## Capability governance',
        '## Orizzonti temporali e cadenze operative',
        '## Degrado del contesto e handoff obbligatorio',
        '## Hook orchestration',
        '## Loop di completamento',
        "Questa valutazione contestuale non e' facoltativa",
        '`skill`, `MCP`, `plugin`, `hook`, `file di memoria`, `audit`, `script` o `workflow`',
        'inventario unico delle capability',
        'routing matrix per domini pratici',
        'gli esempi non vanno trattati come lista chiusa',
        '"allucinazione" include anche',
        'L\'impossibilita\' pratica di leggere "tutto" non giustifica mai una patch isolata',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'AGENTS.md copre la fase A',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'AGENTS.md copre la fase A',
        passed: true,
        detail: "Fonte di verita', hook orchestration e loop di completamento presenti ✅",
    };
}

function checkRootReadme(): CheckResult {
    const path = resolve('README.md');
    const required = ['docs/AI_MASTER_SYSTEM_SPEC.md', 'docs/AI_RUNTIME_BRIEF.md'];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'README root allineato',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'README root allineato',
        passed: true,
        detail: 'Ordine di lettura root include spec madre e nota runtime brief ✅',
    };
}

function checkProjectClaudeAdapter(): CheckResult {
    const path = resolve('CLAUDE.md');
    const required = [
        'docs/AI_MASTER_SYSTEM_SPEC.md',
        'docs/AI_RUNTIME_BRIEF.md',
        'La scelta contestuale di skill, MCP, web/docs, loop, piano e workflow deve partire automaticamente',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'CLAUDE adapter allineato',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'CLAUDE adapter allineato',
        passed: true,
        detail: 'Adapter Claude richiama spec madre, runtime brief e selezione contestuale automatica ✅',
    };
}

function check360Checklist(): CheckResult {
    const path = resolve('docs', '360-checklist.md');
    const required = [
        'La valutazione contestuale di skill, MCP, web/docs, loop, piano, workflow e quality gate parte automaticamente',
        'pattern illustrativi, non come lista esaustiva',
        'Le allucinazioni sono vietate in senso pieno',
        'Se manca la primitive corretta (skill, hook, memoria, audit, workflow)',
        'cambi durevoli o invasivi da proporre con conferma',
        'contesto degrada o si compatta troppo',
        'drift strutturale, dead code, circular deps',
        'blast radius reale con file diretti/indiretti',
        'orizzonte temporale',
        '`UserPromptSubmit`',
        '`PreCompact`',
        'runtime brief',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: '360 checklist allineata',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: '360 checklist allineata',
        passed: true,
        detail: 'Checklist include selezione automatica e nuovi hook runtime ✅',
    };
}

function checkOperatingModel(): CheckResult {
    const path = resolve('docs', 'AI_OPERATING_MODEL.md');
    const required = [
        '## Ordine corretto di implementazione (non numerico)',
        '### Fase A — Base cognitiva e truthful control plane',
        '## Asse temporale trasversale — breve, medio, lungo termine',
        'Da decidere caso per caso con ragionamento esplicito',
        'Questa valutazione deve partire automaticamente a ogni nuovo prompt',
        'gap reale di capability',
        'catalogo installato',
        'routing matrix per domini pratici',
        'degrado del contesto',
        'context-handoff',
        'pattern di ragionamento',
        'allucinare non significa solo',
        'patch locali cieche',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'AI operating model allineato',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'AI operating model allineato',
        passed: true,
        detail: 'Ordine di implementazione e orchestrazione contestuale presenti ✅',
    };
}

function checkMasterSpec(): CheckResult {
    const path = resolve('docs', 'AI_MASTER_SYSTEM_SPEC.md');
    const required = [
        '## 22. Orizzonti temporali e task periodici',
        'breve termine',
        'medio termine',
        'lungo termine',
        'manca la primitive corretta',
        'inventario unico delle capability installate o disponibili',
        'plugin',
        'Caveman, LeanCTX, SIMDex e Contact Skills',
        'contesto corrente sta degradando',
        'elenco esaustivo',
        'esecuzione cieca di ipotesi utente',
        'modifica locale cieca',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'AI master system spec allineata',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'AI master system spec allineata',
        passed: true,
        detail: 'Lista madre include orizzonti temporali e task periodici ✅',
    };
}

function checkActiveTodos(): CheckResult {
    const path = resolve('todos', 'active.md');
    const required = [
        'Orchestrazione cognitiva contestuale',
        'Orizzonti temporali del task',
        'Gap di capability + context degradation',
        'catalogo capability ordinato',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'Todo attivo sulla fase A',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'Todo attivo sulla fase A',
        passed: true,
        detail: 'Backlog attivo contiene orchestrazione contestuale e asse temporale del task ✅',
    };
}

function checkPackageScripts(): CheckResult {
    const packageJson = readJson<PackageJsonShape>(resolve('package.json'));
    const scripts = packageJson?.scripts ?? {};
    const requiredScripts = [
        'pre-modifiche',
        'post-modifiche',
        'conta-problemi',
        'audit:hooks',
        'audit:ai-control-plane',
        'audit:git-automation',
        'audit:git-automation:strict:commit',
        'audit:git-automation:strict:push',
        'audit:rule-enforcement',
    ];
    const missing = requiredScripts.filter((scriptName) => !(scriptName in scripts));
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'Script di audit e gate disponibili',
            passed: false,
            detail: `package.json incompleto. Script mancanti: ${missing.join(', ')}`,
        };
    }
    return {
        area: 'Repo canonici',
        name: 'Script di audit e gate disponibili',
        passed: true,
        detail: 'Gate e audit canonici esposti in package.json ✅',
    };
}

function checkGitAutomationHooks(): CheckResult {
    const path = join(homedir(), '.claude', 'settings.json');
    const settings = readJson<Record<string, unknown>>(path);
    if (!settings) {
        return {
            area: 'Control plane globale',
            name: 'Git hooks di automazione presenti',
            passed: false,
            detail: `${path} non trovato o non leggibile.`,
        };
    }

    const missing: string[] = [];
    if (!findHookCommand(settings, 'PreToolUse', 'pre-bash-l1-gate.ps1')) {
        missing.push('pre-bash-l1-gate.ps1');
    }
    if (!findHookCommand(settings, 'PreToolUse', 'pre-bash-git-gate.ps1')) {
        missing.push('pre-bash-git-gate.ps1');
    }
    if (!findHookCommand(settings, 'PostToolUse', 'post-bash-git-audit.ps1')) {
        missing.push('post-bash-git-audit.ps1');
    }

    if (missing.length > 0) {
        return {
            area: 'Control plane globale',
            name: 'Git hooks di automazione presenti',
            passed: false,
            detail: `${path} incompleto. Hook mancanti: ${missing.join(', ')}`,
        };
    }

    return {
        area: 'Control plane globale',
        name: 'Git hooks di automazione presenti',
        passed: true,
        detail: 'Gate git pre/post presenti in settings.json ✅',
    };
}

function checkGlobalClaudeOrchestration(): CheckResult {
    const path = join(homedir(), '.claude', 'CLAUDE.md');
    const text = readText(path);
    if (!text) {
        return {
            area: 'Control plane globale',
            name: 'CLAUDE globale allineato',
            passed: false,
            detail: `${path} non trovato.`,
        };
    }

    const required = [
        '# Orchestrazione cognitiva contestuale',
        'Non esiste un flusso rigido identico per ogni richiesta.',
    ];
    const missing = missingSnippets(text, required);
    const stillRigid = text.includes('# PRIMA — DURANTE — DOPO (ogni richiesta, sempre, automaticamente)');

    if (missing.length > 0 || stillRigid) {
        const details = [...missing];
        if (stillRigid) {
            details.push('titolo rigido legacy ancora presente');
        }
        return {
            area: 'Control plane globale',
            name: 'CLAUDE globale allineato',
            passed: false,
            detail: formatMissing(path, details),
        };
    }

    return {
        area: 'Control plane globale',
        name: 'CLAUDE globale allineato',
        passed: true,
        detail: 'Orchestrazione contestuale presente e flusso rigido legacy assente ✅',
    };
}

function checkSessionStartHook(): CheckResult {
    const path = join(homedir(), '.claude', 'settings.json');
    const settings = readJson<Record<string, unknown>>(path);
    if (!settings) {
        return {
            area: 'Control plane globale',
            name: 'SessionStart hook configurato',
            passed: false,
            detail: `${path} non trovato o non leggibile.`,
        };
    }

    if (!findHookCommand(settings, 'SessionStart', 'session-start.ps1')) {
        return {
            area: 'Control plane globale',
            name: 'SessionStart hook configurato',
            passed: false,
            detail: 'settings.json non richiama session-start.ps1 in SessionStart.',
        };
    }

    return {
        area: 'Control plane globale',
        name: 'SessionStart hook configurato',
        passed: true,
        detail: 'SessionStart richiama session-start.ps1 ✅',
    };
}

function checkSessionStartMemoryCoverage(): CheckResult {
    const path = join(homedir(), '.claude', 'hooks', 'session-start.ps1');
    const required = [
        'user.md',
        'personality.md',
        'preferences.md',
        'decisions.md',
        'active.md',
        'PROJECT_MEMORY_INDEX',
        'PROJECT_RUNTIME_BRIEF',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Control plane globale',
            name: 'Session-start copre memoria critica',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Control plane globale',
        name: 'Session-start copre memoria critica',
        passed: true,
        detail: 'Memoria globale + todos + indice memoria progetto + runtime brief caricati dal hook ✅',
    };
}

function checkRuntimeBriefDoc(): CheckResult {
    const path = resolve('docs', 'AI_RUNTIME_BRIEF.md');
    const required = [
        "Non e' la fonte di verita' primaria.",
        '## Requirement ledger obbligatorio per prompt lunghi o densi',
        '## Selezione strumenti',
        '## Prima di chiudere',
        'orizzonte temporale dominante',
        'Valutare ogni volta, in modo contestuale e automatico',
        "L'utente non deve ricordare all'AI di fare questa valutazione",
        'Se manca la primitive giusta',
        'plugin',
        'routing matrix mentale',
        'Non accumulare capability sovrapposte',
        'Monitorare segnali di degrado del contesto',
        "esempi forniti dall'utente",
        'pattern da estendere',
        'Nessuna allucinazione',
        'comando da eseguire ciecamente',
        'code search, mapping dipendenze/test, memoria',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'AI runtime brief presente e completo',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'AI runtime brief presente e completo',
        passed: true,
        detail: 'Digest runtime compatto presente e allineabile ai canonici ✅',
    };
}

function checkUserPromptSubmitHook(): CheckResult {
    const path = join(homedir(), '.claude', 'settings.json');
    const settings = readJson<Record<string, unknown>>(path);
    if (!settings) {
        return {
            area: 'Control plane globale',
            name: 'UserPromptSubmit runtime hook configurato',
            passed: false,
            detail: `${path} non trovato o non leggibile.`,
        };
    }

    if (!findHookCommand(settings, 'UserPromptSubmit', 'inject-runtime-brief.ps1 -HookEventName UserPromptSubmit')) {
        return {
            area: 'Control plane globale',
            name: 'UserPromptSubmit runtime hook configurato',
            passed: false,
            detail: 'settings.json non richiama inject-runtime-brief.ps1 in UserPromptSubmit.',
        };
    }

    return {
        area: 'Control plane globale',
        name: 'UserPromptSubmit runtime hook configurato',
        passed: true,
        detail: 'UserPromptSubmit reinietta il runtime brief a ogni prompt ✅',
    };
}

function checkPreCompactHook(): CheckResult {
    const path = join(homedir(), '.claude', 'settings.json');
    const settings = readJson<Record<string, unknown>>(path);
    if (!settings) {
        return {
            area: 'Control plane globale',
            name: 'PreCompact runtime hook configurato',
            passed: false,
            detail: `${path} non trovato o non leggibile.`,
        };
    }

    if (!findHookCommand(settings, 'PreCompact', 'inject-runtime-brief.ps1 -HookEventName PreCompact')) {
        return {
            area: 'Control plane globale',
            name: 'PreCompact runtime hook configurato',
            passed: false,
            detail: 'settings.json non richiama inject-runtime-brief.ps1 in PreCompact.',
        };
    }

    return {
        area: 'Control plane globale',
        name: 'PreCompact runtime hook configurato',
        passed: true,
        detail: 'PreCompact reinietta il runtime brief prima del compact ✅',
    };
}

function readSkillText(skillDirName: string): string | null {
    const skillDir = join(homedir(), '.claude', 'skills', skillDirName);
    const candidates = [join(skillDir, 'skill.md'), join(skillDir, 'index.md')];
    for (const candidate of candidates) {
        const text = readText(candidate);
        if (text) {
            return text;
        }
    }
    return null;
}

function checkContextHandoffSkill(): CheckResult {
    const skillText = readSkillText('context-handoff');
    const required = ['Git status', 'SESSION_HANDOFF.md', 'active.md coerente'];
    const missing = missingSnippets(skillText, required);
    if (missing.length > 0) {
        return {
            area: 'Skill globali',
            name: 'Skill context-handoff completa',
            passed: false,
            detail: formatMissing('~/.claude/skills/context-handoff', missing),
        };
    }
    return {
        area: 'Skill globali',
        name: 'Skill context-handoff completa',
        passed: true,
        detail: 'Pre/post-condition e handoff operativo presenti ✅',
    };
}

function checkLoopCodexSkill(): CheckResult {
    const skillText = readSkillText('loop-codex');
    const required = ['Max iterazioni', 'Auto-commit', 'ENGINEERING_WORKLOG'];
    const missing = missingSnippets(skillText, required);
    if (missing.length > 0) {
        return {
            area: 'Skill globali',
            name: 'Skill loop-codex completa',
            passed: false,
            detail: formatMissing('~/.claude/skills/loop-codex', missing),
        };
    }
    return {
        area: 'Skill globali',
        name: 'Skill loop-codex completa',
        passed: true,
        detail: 'Loop misurabile, max iterazioni e chiusura documentata presenti ✅',
    };
}

function checkAuditRulesSkill(): CheckResult {
    const skillText = readSkillText('audit-rules');
    if (!skillText) {
        return {
            area: 'Skill globali',
            name: 'Skill audit-rules disponibile',
            passed: false,
            detail: '~/.claude/skills/audit-rules non trovata.',
        };
    }
    return {
        area: 'Skill globali',
        name: 'Skill audit-rules disponibile',
        passed: true,
        detail: 'Skill audit-rules presente ✅',
    };
}

function run(): void {
    console.log('\n=== AI Control Plane Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    const checks: CheckResult[] = [
        checkRepoAgents(),
        checkRootReadme(),
        checkProjectClaudeAdapter(),
        checkMasterSpec(),
        checkOperatingModel(),
        check360Checklist(),
        checkActiveTodos(),
        checkRuntimeBriefDoc(),
        checkPackageScripts(),
        checkGlobalClaudeOrchestration(),
        checkSessionStartHook(),
        checkSessionStartMemoryCoverage(),
        checkUserPromptSubmitHook(),
        checkPreCompactHook(),
        checkGitAutomationHooks(),
        checkContextHandoffSkill(),
        checkLoopCodexSkill(),
        checkAuditRulesSkill(),
    ];

    let allPassed = true;
    let currentArea = '';

    for (const check of checks) {
        if (check.area !== currentArea) {
            currentArea = check.area;
            console.log(`--- ${currentArea} ---`);
        }

        const icon = check.passed ? '✅' : '❌';
        console.log(`${icon} ${check.name}`);
        if (!check.passed) {
            console.log(`   → ${check.detail}`);
            allPassed = false;
        }
    }

    const passed = checks.filter((check) => check.passed).length;
    console.log(`\n--- ${passed}/${checks.length} check passati ---`);

    if (allPassed) {
        console.log('✅ Repo canonici, hook e skill chiave sono coerenti.\n');
        process.exit(0);
    }

    console.log("\n❌ Il control plane AI non e' ancora completamente coerente.");
    checks
        .filter((check) => !check.passed)
        .forEach((check) => console.log(`  - [${check.area}] ${check.name}: ${check.detail}`));
    console.log('');
    process.exit(1);
}

run();
