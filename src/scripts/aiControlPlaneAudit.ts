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

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

import {
    findHookCommand,
    findHookCommandParts,
    formatMissing,
    missingSnippets,
    readJson,
    readText,
} from './lib/auditCore';

interface CheckResult {
    area: string;
    name: string;
    passed: boolean;
    detail: string;
}

interface PackageJsonShape {
    scripts?: Record<string, string>;
}

function checkRepoAgents(): CheckResult {
    const path = resolve('AGENTS.md');
    const required = [
        'Le regole di orchestrazione cognitiva, requirement ledger, orizzonti temporali, blast radius documentale e handoff sono in `docs/AI_RUNTIME_BRIEF.md`',
        "## Fonte di verita' e routing strumenti",
        '## Automazione: ordine di promozione',
        '## File canonici da leggere e mantenere allineati',
        '## Loop di completamento',
        'docs/AI_MASTER_SYSTEM_SPEC.md',
        'docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md',
        'docs/AI_IMPLEMENTATION_LIST_GLOBAL.md',
        'docs/LINKEDIN_IMPLEMENTATION_LIST.md',
        'Procedura cognitiva ripetibile → skill. Regola non dimenticabile → hook. Controllo deterministico → script/test/lint. Automazione durevole → n8n/workflow persistente.',
        'Documenti, audit e stato reale divergono → bug operativo da correggere subito.',
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
        detail: 'Routing strumenti, backlog canonico e loop di completamento presenti ✅',
    };
}

function checkRootReadme(): CheckResult {
    const path = resolve('README.md');
    const required = [
        'docs/AI_MASTER_SYSTEM_SPEC.md',
        'docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md',
        'docs/AI_RUNTIME_BRIEF.md',
    ];
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
        detail: 'Ordine di lettura root include spec, backlog madre e nota runtime brief ✅',
    };
}

function checkProjectClaudeAdapter(): CheckResult {
    const path = resolve('CLAUDE.md');
    const required = [
        'docs/AI_MASTER_SYSTEM_SPEC.md',
        'docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md',
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
        detail: 'Adapter Claude richiama spec, backlog, runtime brief e selezione contestuale automatica ✅',
    };
}

function check360Checklist(): CheckResult {
    const path = resolve('docs', '360-checklist.md');
    const required = [
        'La gerarchia P0 parte prima di piano, skill, edit o risposta',
        "decomposizione ricorsiva dell'argomento",
        "albero dell'argomento",
        'sotto-sottopunti',
        'Per ogni ramo',
        "continuita' proattiva",
        'Ogni chiusura operativa include prossimo passo concreto',
        'La valutazione contestuale di skill, MCP, web/docs, loop, piano, workflow e quality gate parte automaticamente',
        'pattern illustrativi, non come lista esaustiva',
        'Le allucinazioni sono vietate in senso pieno',
        'Se manca la primitive corretta (skill, hook, memoria, audit, workflow)',
        'npx skills find',
        'skills.sh',
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
        '### Fase A — Orchestrator Layer, base cognitiva e truthful control plane',
        'Gerarchia P0',
        'input utente come ipotesi',
        "decomposizione ricorsiva dell'argomento",
        "albero dell'argomento",
        'sotto-sottopunti',
        'visione 360/lungo termine',
        "continuita' proattiva",
        'fonte/primitive/verifica',
        'Orchestrator Layer',
        'input -> classificazione -> fonte -> capability -> modello/ambiente -> piano/verifiche -> output',
        'modello canonico resta di 9 livelli',
        'enforcement meccanico attuale copre L1 e L7-L9',
        'L2-L6 restano definiti ma ancora da promuovere',
        'routing operativo advisory implementato',
        'AI_ADK_CAPABILITY_GOVERNANCE.json',
        'audit:adk-capabilities',
        'L2-L6 audit-assisted',
        'Da decidere caso per caso con ragionamento esplicito',
        'Principio madre',
        'modello della situazione',
        'root cause/problema reale',
        'soluzione migliore verificabile',
        'npx skills find',
        'skills.sh',
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
        detail: 'Ordine di implementazione e narrativa coerente sul modello a 9 livelli presenti ✅',
    };
}

function checkMasterSpec(): CheckResult {
    const path = resolve('docs', 'AI_MASTER_SYSTEM_SPEC.md');
    const required = [
        '## 22. Orizzonti temporali e task periodici',
        'Principio madre: ragionamento 360',
        'Priorita P0 non negoziabile',
        'Input utente come ipotesi',
        'Decomposizione ricorsiva',
        "albero dell'argomento",
        'sotto-sottopunti',
        'Visione 360/lungo termine',
        'Fonte/primitive/verifica',
        "Continuita' proattiva",
        'stop-proactive-next-step.ps1',
        'domanda specifica',
        'Orchestrator Layer: decisione centrale prima dell\'esecuzione',
        'control plane che coordina regole, memoria, skill, MCP, plugin, hook, subagent, workflow, modello, ambiente, ricerca web e verifiche',
        'skill-finder',
        'Trigger obbligatori',
        'Protocollo operativo',
        'Output minimo nei task non banali',
        'modello della situazione',
        'problemi diretti e indiretti',
        'root cause',
        'soluzione migliore',
        'prima soluzione plausibile',
        'alternative ragionevoli',
        'fonte usata',
        'limiti residui',
        'Il modello canonico resta a 9 livelli.',
        'breve termine',
        'medio termine',
        'lungo termine',
        'manca la primitive corretta',
        'npx skills find',
        'skills.sh',
        'repository ufficiali',
        'inventario unico delle capability installate o disponibili',
        'layer ADK',
        'plugin',
        'Caveman, LeanCTX, SIMDex e Contact Skills',
        'contesto corrente sta degradando',
        'elenco esaustivo',
        'esecuzione cieca di ipotesi utente',
        'modifica locale cieca',
        'codebase hygiene',
        'hook advisory post-edit',
        'file diretto',
        'file indiretti',
        'cancellazioni automatiche',
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
        detail: 'Lista madre include protocollo canonico a 9 livelli e orizzonti temporali ✅',
    };
}

function checkMasterBacklog(): CheckResult {
    const path = resolve('docs', 'AI_MASTER_IMPLEMENTATION_BACKLOG.md');
    const required = [
        'questo documento deve restare la vista unica e completa del "cosa manca ancora"',
        'modello a 9 livelli',
        'L1 e L7-L9 hanno enforcement meccanico reale; L2-L6 sono regole testuali',
        'vista lineare derivata',
        'non seconda autorita',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'AI master backlog governa il mancante',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'AI master backlog governa il mancante',
        passed: true,
        detail: 'Backlog strutturato unico e single list derivata esplicitati ✅',
    };
}

function checkActiveTodos(): CheckResult {
    const path = resolve('todos', 'active.md');
    const required = [
        'AI_MASTER_IMPLEMENTATION_BACKLOG.md',
        'Orchestrazione cognitiva contestuale',
        'Orizzonti temporali del task',
        'Gap di capability + context degradation',
        'catalogo capability ordinato',
        'npx skills find',
        'skills.sh',
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
        'audit:ai-control-plane:docs',
        'audit:ai-reasoning-hardening',
        'audit:orchestrator-contract',
        'audit:reasoning-trace',
        'audit:hook-semantic-coverage',
        'audit:continuation-completeness',
        'audit:codex-hook-parity',
        'audit:ai-list-completeness',
        'audit:ai-backlog-consistency',
        'audit:output-styles',
        'audit:mcp-config',
        'audit:git-automation',
        'audit:git-automation:strict:commit',
        'audit:git-automation:strict:push',
        'audit:routing',
        'audit:adk-capabilities',
        'audit:l2-l6',
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

function checkCodebaseHygieneHook(): CheckResult {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const hookPath = join(homedir(), '.claude', 'hooks', 'post-edit-codebase-hygiene.ps1');
    const settings = readJson<Record<string, unknown>>(settingsPath);
    const missing: string[] = [];

    if (!settings) {
        missing.push(`${settingsPath} non leggibile`);
    } else if (!findHookCommand(settings, 'PostToolUse', 'post-edit-codebase-hygiene.ps1')) {
        missing.push('settings.json non richiama post-edit-codebase-hygiene.ps1 in PostToolUse');
    }

    const hookRequired = [
        'CODEBASE_HYGIENE',
        'file diretto',
        'file indiretti',
        'duplicati',
        'obsoleti',
        'split',
        'rename',
        'delete',
        'follow-up',
        'Non fare cancellazioni',
    ];
    const hookMissing = missingSnippets(readText(hookPath), hookRequired);
    if (hookMissing.length > 0) {
        missing.push(formatMissing(hookPath, hookMissing));
    }

    if (missing.length > 0) {
        return {
            area: 'Control plane globale',
            name: 'Post-edit codebase hygiene hook configurato',
            passed: false,
            detail: missing.join(' | '),
        };
    }

    return {
        area: 'Control plane globale',
        name: 'Post-edit codebase hygiene hook configurato',
        passed: true,
        detail: 'Hook post-edit per pulizia diretta/indiretta della codebase presente ✅',
    };
}

function checkStopProactiveNextStepHook(): CheckResult {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const hookPath = join(homedir(), '.claude', 'hooks', 'stop-proactive-next-step.ps1');
    const routerPath = join(homedir(), '.claude', 'scripts', 'model-router-config.mjs');
    const settings = readJson<Record<string, unknown>>(settingsPath);
    const missing: string[] = [];

    if (!settings) {
        missing.push(`${settingsPath} non leggibile`);
    } else if (!findHookCommand(settings, 'Stop', 'stop-proactive-next-step.ps1')) {
        missing.push('settings.json non richiama stop-proactive-next-step.ps1 in Stop');
    }

    const hookRequired = [
        'PROACTIVE_NEXT_STEP_GATE',
        'prossimi passi concreti',
        'domanda specifica',
        'dimmi tu',
        'Write-HookAdditionalContext',
    ];
    const hookMissing = missingSnippets(readText(hookPath), hookRequired);
    if (hookMissing.length > 0) {
        missing.push(formatMissing(hookPath, hookMissing));
    }

    const routerMissing = missingSnippets(readText(routerPath), ['stop-proactive-next-step.ps1']);
    if (routerMissing.length > 0) {
        missing.push(formatMissing(routerPath, routerMissing));
    }

    if (missing.length > 0) {
        return {
            area: 'Control plane globale',
            name: 'Stop proactive next-step hook configurato',
            passed: false,
            detail: missing.join(' | '),
        };
    }

    return {
        area: 'Control plane globale',
        name: 'Stop proactive next-step hook configurato',
        passed: true,
        detail: 'Stop hook per continuita operativa presente in settings e fonte canonica ✅',
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
        'docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md',
        'AI_CAPABILITY_ROUTING.json',
        'AI_ADK_CAPABILITY_GOVERNANCE.json',
        'AI_LEVEL_ENFORCEMENT.json',
        '## Gerarchia P0 prima di ogni ragionamento',
        'Input utente come ipotesi',
        'Esempi come pattern',
        'Decomposizione ricorsiva',
        "albero dell'argomento",
        'sotto-sottopunti',
        'per ogni ramo',
        'Visione 360/lungo termine',
        'Root cause/soluzione migliore',
        'Fonte/primitive/verifica',
        "Continuita' proattiva",
        'Chiusura proattiva',
        'stop-proactive-next-step.ps1',
        'domanda specifica',
        '## Requirement ledger obbligatorio per prompt lunghi o densi',
        '## Protocollo ragionamento 360',
        'Orchestrator Layer: prima di eseguire un task non banale',
        'skill-finder',
        'capability finder',
        'Output minimo quando il task e\' non banale',
        'Limite: ragionamento 360',
        'modello della situazione',
        'domini direttamente e indirettamente correlati',
        "problemi prevedibili specifici dell'argomento",
        'Protocollo soluzione migliore',
        'root cause',
        'alternative considerate',
        'primo workaround',
        'fonte usata',
        'verifiche fatte/non fatte',
        'limiti residui',
        '## Selezione strumenti',
        '## Prima di chiudere',
        'Il modello canonico',
        '9 livelli',
        'L7-L9',
        'L2-L6',
        'audit-assisted',
        'orizzonte temporale dominante',
        'Valutare ogni volta, in modo contestuale e automatico',
        "L'utente non deve ricordare all'AI di fare questa valutazione",
        'Se manca la primitive giusta',
        'npx skills find',
        'skills.sh',
        'repo affidabili',
        'plugin',
        'layer ADK corretto',
        'routing matrix mentale',
        'Non accumulare capability sovrapposte',
        'Monitorare segnali di degrado del contesto',
        "esempi forniti dall'utente",
        'TUTTI i casi analoghi',
        'Nessuna allucinazione',
        'comando da eseguire ciecamente',
        'code search, mapping dipendenze/test, memoria',
        'Codebase hygiene sempre',
        'Edit/Write/MultiEdit',
        'file diretto',
        'file indiretti',
        'cleanup invasivo senza conferma',
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

function checkOrchestratorContractDoc(): CheckResult {
    const path = resolve('docs', 'tracking', 'AI_ORCHESTRATOR_CONTRACT.md');
    const required = [
        '## Scope',
        '## Trigger',
        '## Contratto Operativo',
        '## Traccia Operativa Osservabile',
        '## Hook Coverage',
        'Intento reale prima del testo letterale',
        'Input utente come ipotesi',
        'Esempi come pattern',
        'Decomposizione ricorsiva',
        'Root cause prima del workaround',
        'Fonte di verita corretta',
        'Capability routing automatico',
        'Blast radius L2-L9',
        'Cross-domain per ogni file',
        'Truthful completion',
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PreCompact',
        'Stop',
        'Codex',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'AI orchestrator contract presente',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }
    return {
        area: 'Repo canonici',
        name: 'AI orchestrator contract presente',
        passed: true,
        detail: 'Contratto operativo AI esplicito e auditabile presente ✅',
    };
}

function checkRoutingRegistries(): CheckResult {
    const routingPath = resolve('docs', 'tracking', 'AI_CAPABILITY_ROUTING.json');
    const levelPath = resolve('docs', 'tracking', 'AI_LEVEL_ENFORCEMENT.json');
    const adkPath = resolve('docs', 'tracking', 'AI_ADK_CAPABILITY_GOVERNANCE.json');
    const missing = [routingPath, levelPath, adkPath].filter((path) => !existsSync(path));
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'Registri machine-readable del control plane presenti',
            passed: false,
            detail: `Registri mancanti: ${missing.join(', ')}`,
        };
    }
    return {
        area: 'Repo canonici',
        name: 'Registri machine-readable del control plane presenti',
        passed: true,
        detail: 'AI_CAPABILITY_ROUTING.json, AI_LEVEL_ENFORCEMENT.json e AI_ADK_CAPABILITY_GOVERNANCE.json presenti ✅',
    };
}

function checkTrackingReadmeChangeMap(): CheckResult {
    const path = resolve('docs', 'tracking', 'README.md');
    const required = [
        '## Change map sistema AI',
        'Nuova regola/requisito AI globale',
        'Nuova capability/skill/MCP/plugin/agente',
        'Nuovo hook Claude Code',
        'model-router-config.mjs',
        'AI_CAPABILITY_ROUTING.json',
        'AI_ADK_CAPABILITY_GOVERNANCE.json',
        'AI_LEVEL_ENFORCEMENT.json',
        '.claude/CONTINUATION.md',
        'Resources/continuita/START-NEXT-CHAT.md',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Repo canonici',
            name: 'Tracking README contiene change map futura',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }

    return {
        area: 'Repo canonici',
        name: 'Tracking README contiene change map futura',
        passed: true,
        detail: 'Mappa aggiornamento futuro per regole, capability, hook, livelli e handoff presente ✅',
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

    if (!findHookCommandParts(settings, 'UserPromptSubmit', ['inject-runtime-brief.ps1', 'UserPromptSubmit'])) {
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

function checkSkillActivationHook(): CheckResult {
    const path = join(homedir(), '.claude', 'settings.json');
    const settings = readJson<Record<string, unknown>>(path);
    if (!settings) {
        return {
            area: 'Control plane globale',
            name: 'UserPromptSubmit skill routing hook configurato',
            passed: false,
            detail: `${path} non trovato o non leggibile.`,
        };
    }

    if (!findHookCommand(settings, 'UserPromptSubmit', 'skill-activation.ps1')) {
        return {
            area: 'Control plane globale',
            name: 'UserPromptSubmit skill routing hook configurato',
            passed: false,
            detail: 'settings.json non richiama skill-activation.ps1 in UserPromptSubmit.',
        };
    }

    return {
        area: 'Control plane globale',
        name: 'UserPromptSubmit skill routing hook configurato',
        passed: true,
        detail: 'UserPromptSubmit richiama skill-activation.ps1 ✅',
    };
}

function checkSkillActivationP0Reminder(): CheckResult {
    const path = join(homedir(), '.claude', 'hooks', 'skill-activation.ps1');
    const required = [
        'P0 ordine cognitivo',
        'input utente come ipotesi',
        'esempi come pattern',
        'decomposizione ricorsiva',
        'albero argomento',
        'sotto-sottopunti',
        'per ogni ramo',
        'visione 360/lungo termine',
        'root cause/soluzione migliore',
        'fonte/primitive/verifica',
        'continuita proattiva',
        'truthful completion',
        'Chiusura proattiva',
        'domanda concreta',
    ];
    const missing = missingSnippets(readText(path), required);
    if (missing.length > 0) {
        return {
            area: 'Control plane globale',
            name: 'Skill activation reinietta P0 compatto',
            passed: false,
            detail: formatMissing(path, missing),
        };
    }

    return {
        area: 'Control plane globale',
        name: 'Skill activation reinietta P0 compatto',
        passed: true,
        detail: 'skill-activation.ps1 espone l\'ordine cognitivo P0 nel routing advisory ✅',
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

    if (!findHookCommandParts(settings, 'PreCompact', ['inject-runtime-brief.ps1', 'PreCompact'])) {
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
    const required = ['Git status', '.claude/CONTINUATION.md', 'Resources/continuita', 'fallback legacy'];
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
        detail: 'Pre/post-condition aggiornate a CONTINUATION.md + Obsidian, legacy fallback presente ✅',
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
        checkMasterBacklog(),
        checkOperatingModel(),
        check360Checklist(),
        checkActiveTodos(),
        checkRuntimeBriefDoc(),
        checkOrchestratorContractDoc(),
        checkRoutingRegistries(),
        checkTrackingReadmeChangeMap(),
        checkPackageScripts(),
        checkGlobalClaudeOrchestration(),
        checkSessionStartHook(),
        checkSessionStartMemoryCoverage(),
        checkUserPromptSubmitHook(),
        checkSkillActivationHook(),
        checkSkillActivationP0Reminder(),
        checkPreCompactHook(),
        checkGitAutomationHooks(),
        checkCodebaseHygieneHook(),
        checkStopProactiveNextStepHook(),
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
