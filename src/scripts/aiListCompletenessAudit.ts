/**
 * aiListCompletenessAudit.ts
 *
 * Verifica che la lista del sistema AI globale resti completa, operativa
 * e separata dal backlog applicativo LinkedIn.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

interface Section {
    heading: string;
    body: string;
}

function readText(path: string): string {
    if (!existsSync(path)) {
        throw new Error(`File non trovato: ${path}`);
    }
    return readFileSync(path, 'utf8');
}

function extractBetween(text: string, startMarker: string, endMarker: string): string {
    const start = text.indexOf(startMarker);
    if (start === -1) {
        return '';
    }

    const end = text.indexOf(endMarker, start + startMarker.length);
    if (end === -1) {
        return text.slice(start);
    }

    return text.slice(start, end);
}

function extractSections(text: string, headingPattern: RegExp): Section[] {
    const matches = [...text.matchAll(headingPattern)];
    return matches.map((match, index) => {
        const start = match.index ?? 0;
        const next = matches[index + 1];
        const end = next?.index ?? text.length;
        return {
            heading: match[0],
            body: text.slice(start, end),
        };
    });
}

function missingSnippets(text: string, snippets: string[]): string[] {
    return snippets.filter((snippet) => !text.includes(snippet));
}

function checkMasterSections(masterText: string): CheckResult {
    const sections = extractSections(masterText, /^## \d+\. .+$/gm);
    const requiredFields = [
        'Status:',
        'Orizzonte:',
        'Problema reale:',
        'Stato attuale:',
        'Trigger operativo:',
        'Output atteso:',
        'Limiti / non-goals:',
        'Primitive corrette:',
        'Ordine logico:',
        'Sottopunti operativi:',
        'Criterio done:',
        'Verifiche richieste:',
    ];

    const incomplete = sections
        .map((section) => ({
            heading: section.heading,
            missing: missingSnippets(section.body, requiredFields),
        }))
        .filter((section) => section.missing.length > 0);

    if (sections.length === 0) {
        return {
            name: 'Backlog madre: sezioni numerate presenti',
            passed: false,
            detail: 'Nessuna sezione numerata trovata in AI_MASTER_IMPLEMENTATION_BACKLOG.md.',
        };
    }

    if (incomplete.length > 0) {
        return {
            name: 'Backlog madre: schema uniforme',
            passed: false,
            detail: incomplete
                .map((section) => `${section.heading}: mancano ${section.missing.join(', ')}`)
                .join(' | '),
        };
    }

    return {
        name: 'Backlog madre: schema uniforme',
        passed: true,
        detail: `${sections.length} sezioni AI aperte hanno tutti i campi richiesti.`,
    };
}

function checkLinkedInScope(masterText: string, globalText: string): CheckResult {
    const combinedOpenText = [
        extractSections(masterText, /^## \d+\. .+$/gm)
            .map((section) => section.body)
            .join('\n'),
        extractBetween(globalText, '## Aperti', '## Completati'),
    ].join('\n');

    const forbiddenOperationalDetails = [
        'skipPreflight',
        'WorkflowExecutionResult',
        'runtime_locks',
        'automation_commands',
        'workflowToJobTypes',
        'LOGIN_MISSING',
        'proxy healthy',
        'exit IP',
        'right to erasure',
        'Sentry e i controlli di sicurezza ricevano eventi reali',
    ];
    const present = forbiddenOperationalDetails.filter((detail) => combinedOpenText.includes(detail));

    if (present.length > 0) {
        return {
            name: 'Scope: niente backlog applicativo LinkedIn nella lista AI',
            passed: false,
            detail: `Dettagli LinkedIn-specifici trovati negli aperti AI: ${present.join(', ')}`,
        };
    }

    return {
        name: 'Scope: niente backlog applicativo LinkedIn nella lista AI',
        passed: true,
        detail: 'Gli aperti AI non contengono dettagli operativi del backlog applicativo LinkedIn.',
    };
}

function checkGlobalOpenItems(globalText: string): CheckResult {
    const openText = extractBetween(globalText, '## Aperti', '## Completati');
    const items = extractSections(openText, /^### \d+\. .+$/gm);
    const requiredFields = [
        'Problema:',
        'Stato:',
        'Trigger:',
        'Output:',
        'Limiti:',
        'Primitive:',
        'Ordine:',
        'Sottopunti:',
        'Done:',
        'Verifiche:',
    ];

    const incomplete = items
        .map((item) => ({
            heading: item.heading,
            missing: missingSnippets(item.body, requiredFields),
        }))
        .filter((item) => item.missing.length > 0);

    if (items.length === 0) {
        return {
            name: 'Vista lineare: item aperti presenti',
            passed: false,
            detail: 'Nessun item aperto numerato trovato in AI_IMPLEMENTATION_LIST_GLOBAL.md.',
        };
    }

    if (openText.includes('✅')) {
        return {
            name: 'Vista lineare: completati fuori dagli aperti',
            passed: false,
            detail: 'La sezione Aperti contiene marker di completamento.',
        };
    }

    if (incomplete.length > 0) {
        return {
            name: 'Vista lineare: item aperti operativi',
            passed: false,
            detail: incomplete.map((item) => `${item.heading}: mancano ${item.missing.join(', ')}`).join(' | '),
        };
    }

    return {
        name: 'Vista lineare: item aperti operativi',
        passed: true,
        detail: `${items.length} item aperti hanno campi operativi completi e nessun completato dentro Aperti.`,
    };
}

function checkGlobalCompletedItems(globalText: string): CheckResult {
    const completedText = extractBetween(globalText, '## Completati', '\n---\n##');
    const items = extractSections(completedText, /^### C\d+\. .+$/gm);
    const requiredFields = ['Cosa copre:', 'Dove vive:', 'Prova:', 'Limite residuo:'];

    if (items.length === 0) {
        return {
            name: 'Vista lineare: completati dettagliati presenti',
            passed: false,
            detail: 'Nessun completato strutturato trovato in AI_IMPLEMENTATION_LIST_GLOBAL.md.',
        };
    }

    const incomplete = items
        .map((item) => ({
            heading: item.heading,
            missing: missingSnippets(item.body, requiredFields),
        }))
        .filter((item) => item.missing.length > 0);

    if (incomplete.length > 0) {
        return {
            name: 'Vista lineare: completati espliciti e verificabili',
            passed: false,
            detail: incomplete.map((item) => `${item.heading}: mancano ${item.missing.join(', ')}`).join(' | '),
        };
    }

    return {
        name: 'Vista lineare: completati espliciti e verificabili',
        passed: true,
        detail: `${items.length} completati hanno cosa copre, dove vive, prova e limite residuo.`,
    };
}

function checkContextTransferOpen(masterText: string, globalText: string): CheckResult {
    const openText = [
        extractSections(masterText, /^## \d+\. .+$/gm)
            .map((section) => section.body)
            .join('\n'),
        extractBetween(globalText, '## Aperti', '## Completati'),
    ].join('\n');

    const required = ['nuova chat', 'SESSION_HANDOFF.md', 'SESSION_PROMPT.md', 'prova manuale'];
    const missing = missingSnippets(openText, required);

    if (missing.length > 0) {
        return {
            name: 'Context transfer: resta aperto finche non validato',
            passed: false,
            detail: `Frammenti mancanti negli aperti: ${missing.join(', ')}`,
        };
    }

    return {
        name: 'Context transfer: resta aperto finche non validato',
        passed: true,
        detail: 'Trasferimento nuova chat tracciato come aperto con SESSION_HANDOFF.md, SESSION_PROMPT.md e prova manuale.',
    };
}

function checkAgentDevelopmentKitRequirements(masterText: string, globalText: string): CheckResult {
    const required = [
        'Agent Development Kit',
        'AI_ADK_CAPABILITY_GOVERNANCE.json',
        'audit:adk-capabilities',
        '5 layer',
        'layer globale',
        'layer progetto',
        '`SKILL.md`',
        '`scripts/`',
        '`templates/`',
        '`assets/`',
        'subagent',
        '`plugin.json`',
        'team install',
        'MCP',
    ];
    const masterMissing = missingSnippets(masterText, required);
    const globalMissing = missingSnippets(globalText, required);

    if (masterMissing.length > 0 || globalMissing.length > 0) {
        const details = [
            masterMissing.length > 0 ? `backlog madre manca: ${masterMissing.join(', ')}` : '',
            globalMissing.length > 0 ? `vista lineare manca: ${globalMissing.join(', ')}` : '',
        ].filter(Boolean);

        return {
            name: 'Agent Development Kit: stack a 5 layer tracciato',
            passed: false,
            detail: details.join(' | '),
        };
    }

    return {
        name: 'Agent Development Kit: stack a 5 layer tracciato',
        passed: true,
        detail: 'Backlog madre e vista lineare includono rules/memory, skill, hook, subagent, plugin/distribution e MCP esterni.',
    };
}

function checkReasoning360Requirements(masterText: string, globalText: string): CheckResult {
    const required = [
        'modello della situazione',
        'ragionamento 360',
        'gerarchia P0',
        'input utente come ipotesi',
        "verita' assoluta",
        "decomposizione ricorsiva dell'argomento",
        "albero dell'argomento",
        'sotto-sottopunti',
        'per ogni ramo',
        'visione 360/lungo termine',
        'fonte/primitive/verifica',
        "continuita' proattiva",
        "continuita' operativa",
        'domanda specifica',
        'truthful completion',
        'trigger',
        'output minimo',
        'limiti',
        'internet/docs ufficiali',
        'MCP/tool live',
        'problemi diretti e indiretti',
        'root cause',
        'problema reale',
        'alternative',
        'soluzione migliore',
        'primo workaround',
        'casi analoghi',
        'correlati',
        'fonti usate',
        'verifiche fatte/non fatte',
    ];
    const masterMissing = missingSnippets(masterText, required);
    const globalMissing = missingSnippets(globalText, required);

    if (masterMissing.length > 0 || globalMissing.length > 0) {
        const details = [
            masterMissing.length > 0 ? `backlog madre manca: ${masterMissing.join(', ')}` : '',
            globalMissing.length > 0 ? `vista lineare manca: ${globalMissing.join(', ')}` : '',
        ].filter(Boolean);

        return {
            name: 'Ragionamento 360: principio madre tracciato',
            passed: false,
            detail: details.join(' | '),
        };
    }

    return {
        name: 'Ragionamento 360: principio madre tracciato',
        passed: true,
        detail: 'Backlog madre e vista lineare richiedono modello della situazione, studio dominio e previsione problemi diretti/indiretti.',
    };
}

function checkOrchestratorLayerRequirements(masterText: string, globalText: string): CheckResult {
    const required = [
        'Orchestrator Layer',
        'input normalizzato',
        'task class',
        'fonte',
        'modello',
        'ambiente',
        'skill-finder',
        'capability finder',
        'npx skills find',
        'skills.sh',
        'repo ufficiali',
        'hook',
        'script/audit',
        'subagent',
        'handoff',
        'verifiche',
    ];
    const masterMissing = missingSnippets(masterText, required);
    const globalMissing = missingSnippets(globalText, required);

    if (masterMissing.length > 0 || globalMissing.length > 0) {
        const details = [
            masterMissing.length > 0 ? `backlog madre manca: ${masterMissing.join(', ')}` : '',
            globalMissing.length > 0 ? `vista lineare manca: ${globalMissing.join(', ')}` : '',
        ].filter(Boolean);

        return {
            name: 'Orchestrator Layer: decisione centrale tracciata',
            passed: false,
            detail: details.join(' | '),
        };
    }

    return {
        name: 'Orchestrator Layer: decisione centrale tracciata',
        passed: true,
        detail: 'Backlog madre e vista lineare richiedono decisione orchestrata su fonte, capability, modello, ambiente, handoff e verifiche.',
    };
}

function checkCodebaseHygieneRequirements(masterText: string, globalText: string): CheckResult {
    const required = [
        'post-edit-codebase-hygiene.ps1',
        'codebase hygiene',
        'file diretto',
        'file indiretti',
        'duplicati',
        'obsoleti',
        'split',
        'rename',
        'delete',
        'follow-up',
    ];
    const masterMissing = missingSnippets(masterText, required);
    const globalMissing = missingSnippets(globalText, required);

    if (masterMissing.length > 0 || globalMissing.length > 0) {
        const details = [
            masterMissing.length > 0 ? `backlog madre manca: ${masterMissing.join(', ')}` : '',
            globalMissing.length > 0 ? `vista lineare manca: ${globalMissing.join(', ')}` : '',
        ].filter(Boolean);

        return {
            name: 'Codebase hygiene: hook post-edit tracciato',
            passed: false,
            detail: details.join(' | '),
        };
    }

    return {
        name: 'Codebase hygiene: hook post-edit tracciato',
        passed: true,
        detail: 'Backlog madre e vista lineare richiedono valutazione pulizia su file diretti/indiretti dopo ogni edit.',
    };
}

function checkActiveTodos(todosText: string): CheckResult {
    const required = [
        'Completare e mantenere completa la lista del sistema AI',
        'Fuori scope LinkedIn applicativo',
        'audit:ai-list-completeness',
        'catalogo capability ordinato',
        'Agent Development Kit',
        '5 layer',
        'Orchestrator Layer',
        'Orchestrazione cognitiva contestuale',
        'Orizzonti temporali del task',
        'npx skills find',
        'skills.sh',
    ];
    const missing = missingSnippets(todosText, required);

    if (missing.length > 0) {
        return {
            name: 'Todos: priorita lista AI esplicita',
            passed: false,
            detail: `todos/active.md non contiene: ${missing.join(', ')}`,
        };
    }

    return {
        name: 'Todos: priorita lista AI esplicita',
        passed: true,
        detail: 'todos/active.md distingue priorita AI globale e backlog LinkedIn-specifico.',
    };
}

function run(): void {
    const masterText = readText(resolve('docs', 'AI_MASTER_IMPLEMENTATION_BACKLOG.md'));
    const globalText = readText(resolve('docs', 'AI_IMPLEMENTATION_LIST_GLOBAL.md'));
    const todosText = readText(resolve('todos', 'active.md'));

    const checks: CheckResult[] = [
        checkMasterSections(masterText),
        checkLinkedInScope(masterText, globalText),
        checkGlobalOpenItems(globalText),
        checkGlobalCompletedItems(globalText),
        checkContextTransferOpen(masterText, globalText),
        checkAgentDevelopmentKitRequirements(masterText, globalText),
        checkReasoning360Requirements(masterText, globalText),
        checkOrchestratorLayerRequirements(masterText, globalText),
        checkCodebaseHygieneRequirements(masterText, globalText),
        checkActiveTodos(todosText),
    ];

    console.log('\n=== AI List Completeness Audit ===\n');

    let allPassed = true;
    for (const check of checks) {
        const marker = check.passed ? '[OK]' : '[FAIL]';
        console.log(`${marker} ${check.name}`);
        console.log(`     ${check.detail}`);
        if (!check.passed) {
            allPassed = false;
        }
    }

    const passed = checks.filter((check) => check.passed).length;
    console.log(`\n--- ${passed}/${checks.length} check passati ---`);

    if (!allPassed) {
        process.exit(1);
    }
}

run();
