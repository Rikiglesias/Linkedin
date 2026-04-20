/**
 * levelEnforcementAudit.ts — Audit del protocollo per L2-L9
 *
 * Verifica che:
 * - il registro L2-L9 sia completo e coerente
 * - ogni task class abbia il focus levels previsto (L2-L3 quick-fix, L2-L4+L6+L7+L9 bug, L2-L9 feature)
 * - AI_RUNTIME_BRIEF e AI_OPERATING_MODEL dichiarino lo stato dei livelli
 *
 * Uso:
 *   npx ts-node src/scripts/levelEnforcementAudit.ts
 *   npm run audit:l2-l6
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import {
    classifyPrompt,
    loadLevelRegistry,
    loadRoutingRegistry,
    validateLevelRegistry,
} from './lib/aiControlPlaneRegistry';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

function readText(path: string): string | null {
    if (!existsSync(path)) {
        return null;
    }
    return readFileSync(path, 'utf8');
}

function containsAll(text: string | null, snippets: string[]): boolean {
    if (!text) {
        return false;
    }
    return snippets.every((snippet) => text.includes(snippet));
}

function run(): void {
    console.log('\n=== L2-L9 Enforcement Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    const levelRegistry = loadLevelRegistry();
    const levelIssues = validateLevelRegistry(levelRegistry);

    if (levelIssues.length > 0) {
        console.log('--- Problemi registro livelli ---');
        for (const issue of levelIssues) {
            console.log(`❌ [${issue.scope}] ${issue.message}`);
        }
        console.log('');
        process.exit(1);
    }

    const routingRegistry = loadRoutingRegistry();
    const checks: CheckResult[] = [];

    const quickFixDecision = classifyPrompt(
        'Quick fix piccolo sul modulo interno TypeScript',
        routingRegistry,
        levelRegistry,
    );
    checks.push({
        name: 'quick-fix applica solo L2-L3',
        passed:
            quickFixDecision.taskClass === 'quick-fix' &&
            quickFixDecision.focusLevels.map((level) => level.level).join(',') === 'L2,L3',
        detail: `livelli ottenuti: ${quickFixDecision.focusLevels.map((level) => level.level).join(', ') || 'nessuno'}`,
    });

    const bugDecision = classifyPrompt(
        'Fix bug runtime con errore e failure a meta flusso',
        routingRegistry,
        levelRegistry,
    );
    checks.push({
        name: 'bug applica L2-L4 + L6 + L7 + L9',
        passed:
            bugDecision.taskClass === 'bug' &&
            bugDecision.focusLevels.map((level) => level.level).join(',') === 'L2,L3,L4,L6,L7,L9',
        detail: `livelli ottenuti: ${bugDecision.focusLevels.map((level) => level.level).join(', ') || 'nessuno'}`,
    });

    const featureDecision = classifyPrompt(
        'Implementa nuova feature e refactor end-to-end del flusso',
        routingRegistry,
        levelRegistry,
    );
    checks.push({
        name: 'feature/refactor applica L2-L9 completo',
        passed:
            featureDecision.taskClass === 'feature/refactor' &&
            featureDecision.focusLevels.map((level) => level.level).join(',') === 'L2,L3,L4,L5,L6,L7,L8,L9',
        detail: `livelli ottenuti: ${featureDecision.focusLevels.map((level) => level.level).join(', ') || 'nessuno'}`,
    });

    const runtimeBrief = readText(resolve('docs', 'AI_RUNTIME_BRIEF.md'));
    checks.push({
        name: 'Runtime brief dichiara stato L2-L6 audit-assisted',
        passed: containsAll(runtimeBrief, ['L2-L6', 'audit-assisted', 'AI_LEVEL_ENFORCEMENT.json']),
        detail: 'AI_RUNTIME_BRIEF.md deve citare stato audit-assisted e il registro machine-readable.',
    });
    checks.push({
        name: 'Runtime brief dichiara L7-L9 skill-gated',
        passed: containsAll(runtimeBrief, ['L7-L9', '/verification-protocol']),
        detail: 'AI_RUNTIME_BRIEF.md deve citare L7-L9 e /verification-protocol.',
    });

    const operatingModel = readText(resolve('docs', 'AI_OPERATING_MODEL.md'));
    checks.push({
        name: 'Operating model dichiara routing advisory implementato',
        passed: containsAll(operatingModel, ['routing operativo advisory implementato', 'L2-L6 audit-assisted']),
        detail: 'AI_OPERATING_MODEL.md deve esplicitare routing advisory e L2-L6 audit-assisted.',
    });

    let allPassed = true;
    for (const check of checks) {
        const icon = check.passed ? '✅' : '❌';
        console.log(`${icon} ${check.name}`);
        if (!check.passed) {
            console.log(`   → ${check.detail}`);
            allPassed = false;
        }
    }

    if (!allPassed) {
        console.log('');
        process.exit(1);
    }

    console.log('\n✅ Registro L2-L9 coerente e copertura documentale presente.\n');
}

run();
