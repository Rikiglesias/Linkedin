/**
 * aiControlPlaneAudit.ts — Verifica allineamento dei CANONICI DEL PROGETTO applicativo (meta A)
 *
 * adk-split T11: questo audit era MISTO (verificava sia i canonici del progetto sia il control
 * plane globale ~/.claude). La meta ADK-pura (control plane globale: ZERO_RULES/L_LEVELS/CLAUDE
 * globale, hook di enforcement, skill globali) è stata ESTRATTA in
 * `AI-Control-Plane/06-audit/src/scripts/controlPlaneGlobalAudit.ts` (npm `audit:control-plane-global`).
 *
 * Qui resta SOLO la meta A: i canonici DEL REPO applicativo (AGENTS.md, README, CLAUDE adapter,
 * 360-checklist, todos attivi, tracking README, npm script di progetto). Non verifica più i doc
 * spec ADK (migrati in AI-Control-Plane/spec) né i registri governance (verificati da
 * adkCapabilityGovernance/capabilityRouting in ACP).
 *
 * Uso:
 *   npx ts-node src/scripts/aiControlPlaneAudit.ts
 *   npm run audit:ai-control-plane:docs
 */

import { resolve } from 'path';

import { formatMissing, missingSnippets, readJson, readText } from './lib/auditCore';

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
    const required = ['docs/AI_RUNTIME_BRIEF.md'];
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
        detail: 'Ordine di lettura root richiama il runtime brief ✅',
    };
}

function checkProjectClaudeAdapter(): CheckResult {
    const path = resolve('CLAUDE.md');
    const required = [
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
        detail: 'Adapter Claude richiama runtime brief e selezione contestuale automatica ✅',
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

function checkTrackingReadmeChangeMap(): CheckResult {
    const path = resolve('docs', 'tracking', 'README.md');
    const required = [
        '## Change map sistema AI',
        'Nuova regola/requisito AI globale',
        'Nuova capability/skill/MCP/plugin/agente',
        'Nuovo hook Claude Code',
        'model-router-config.mjs',
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
        detail: 'Mappa aggiornamento futuro per regole, capability, hook e handoff presente ✅',
    };
}

function checkPackageScripts(): CheckResult {
    const packageJson = readJson<PackageJsonShape>(resolve('package.json'));
    const scripts = packageJson?.scripts ?? {};
    // Gate operativi + audit RESIDENTI del progetto. Gli audit ADK migrati in ACP
    // (audit:hooks, audit:routing, audit:adk-capabilities) NON sono più attesi qui.
    const requiredScripts = [
        'pre-modifiche',
        'post-modifiche',
        'conta-problemi',
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
        detail: 'Gate e audit residenti del progetto esposti in package.json ✅',
    };
}

function run(): void {
    console.log('\n=== AI Project Canonical Audit (meta A) ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}`);
    console.log('Control plane globale (~/.claude): vedi audit:control-plane-global in AI-Control-Plane\n');

    const checks: CheckResult[] = [
        checkRepoAgents(),
        checkRootReadme(),
        checkProjectClaudeAdapter(),
        check360Checklist(),
        checkActiveTodos(),
        checkTrackingReadmeChangeMap(),
        checkPackageScripts(),
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
        console.log('✅ Canonici del progetto applicativo coerenti.\n');
        process.exit(0);
    }

    console.log("\n❌ I canonici del progetto non sono ancora completamente coerenti.");
    checks
        .filter((check) => !check.passed)
        .forEach((check) => console.log(`  - [${check.area}] ${check.name}: ${check.detail}`));
    console.log('');
    process.exit(1);
}

run();
