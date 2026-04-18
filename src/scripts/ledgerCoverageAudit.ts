/**
 * ledgerCoverageAudit.ts — Verifica che il requirement ledger sia definito e completo
 *
 * Controlla che AI_RUNTIME_BRIEF.md contenga tutti gli elementi obbligatori
 * del requirement ledger e che AGENTS.md li richiami coerentemente.
 *
 * Uso:
 *   npx ts-node src/scripts/ledgerCoverageAudit.ts
 *   npm run audit:ledger
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

function readText(filePath: string): string | null {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf8');
}

const BRIEF_PATH = resolve('docs', 'AI_RUNTIME_BRIEF.md');
const AGENTS_PATH = resolve('AGENTS.md');

const LEDGER_ELEMENTS = [
    { id: 'obiettivo', snippet: 'obiettivo reale', label: 'Obiettivo reale del task' },
    { id: 'requisiti-espliciti', snippet: 'requisiti espliciti', label: 'Requisiti espliciti' },
    { id: 'requisiti-sottili', snippet: 'requisiti sottili', label: 'Requisiti sottili o qualitativi' },
    { id: 'esempi', snippet: 'esempi forniti', label: "Esempi forniti dall'utente" },
    {
        id: 'controlli-inferiti',
        snippet: 'controlli aggiuntivi da inferire',
        label: 'Controlli da inferire dagli esempi',
    },
    { id: 'best-practice', snippet: 'best practice implicite', label: 'Best practice implicite ma obbligatorie' },
    { id: 'controlli-fasi', snippet: "controlli da fare all'inizio", label: 'Controlli inizio/durante/fine' },
    { id: 'strumenti', snippet: 'strumenti o primitive da valutare', label: 'Strumenti o primitive da valutare' },
    { id: 'completezza', snippet: 'criteri di completezza', label: 'Criteri di completezza' },
    { id: 'non-verificati', snippet: 'non ancora verificati', label: 'Punti non ancora verificati' },
];

const COVERAGE_CHECKS = [
    { snippet: 'coverage check del ledger', label: 'Coverage check prima di chiudere' },
    { snippet: 'pattern da estendere', label: 'Esempi come pattern da estendere' },
    { snippet: 'Requirement ledger obbligatorio', label: 'Ledger dichiarato obbligatorio' },
];

function run(): void {
    console.log('\n=== Requirement Ledger Coverage Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    const brief = readText(BRIEF_PATH);
    const agents = readText(AGENTS_PATH);

    const results: CheckResult[] = [];

    // Check ledger elements in brief
    console.log('--- Elementi ledger in AI_RUNTIME_BRIEF.md ---');
    for (const el of LEDGER_ELEMENTS) {
        const found = brief?.includes(el.snippet) ?? false;
        results.push({
            name: `Ledger: ${el.label}`,
            passed: found,
            detail: found ? `"${el.snippet}" presente` : `"${el.snippet}" ASSENTE dal brief`,
        });
        const icon = found ? '\u2705' : '\u26A0\uFE0F';
        console.log(`${icon} ${el.label}`);
        if (!found) console.log(`   \u2192 Snippet mancante: "${el.snippet}"`);
    }

    // Check coverage enforcement
    console.log('\n--- Enforcement copertura ledger ---');
    for (const check of COVERAGE_CHECKS) {
        const inBrief = brief?.includes(check.snippet) ?? false;
        const inAgents = agents?.includes(check.snippet) ?? false;
        const passed = inBrief || inAgents;
        results.push({
            name: `Coverage: ${check.label}`,
            passed,
            detail: passed
                ? `Presente in ${inBrief ? 'brief' : ''}${inBrief && inAgents ? ' + ' : ''}${inAgents ? 'AGENTS.md' : ''}`
                : `"${check.snippet}" assente da brief E AGENTS.md`,
        });
        const icon = passed ? '\u2705' : '\u26A0\uFE0F';
        console.log(`${icon} ${check.label}`);
    }

    // Check style guide exists
    const styleGuide = existsSync(resolve('docs', 'AI_DOC_STYLE_GUIDE.md'));
    results.push({
        name: 'Style guide documenti AI',
        passed: styleGuide,
        detail: styleGuide ? 'docs/AI_DOC_STYLE_GUIDE.md presente' : 'Style guide mancante',
    });
    console.log(`\n--- Documentazione ---`);
    console.log(`${styleGuide ? '\u2705' : '\u26A0\uFE0F'} Style guide documenti AI-readable`);

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed);

    console.log(`\n--- ${passed}/${results.length} check passati ---`);
    if (failed.length === 0) {
        console.log('\u2705 Ledger coverage completa.');
        process.exit(0);
    } else {
        console.log(`\n\u26A0\uFE0F ${failed.length} gap:`);
        failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
        process.exit(1);
    }
}

run();
