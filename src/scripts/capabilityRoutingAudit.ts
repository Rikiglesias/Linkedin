/**
 * capabilityRoutingAudit.ts — Audit della routing matrix AI machine-readable
 *
 * Verifica che:
 * - il registro capability/domini esista e sia valido
 * - i domini obbligatori siano coperti
 * - i riferimenti a capability siano coerenti
 * - la classificazione base funzioni su prompt canonici
 *
 * Uso:
 *   npx ts-node src/scripts/capabilityRoutingAudit.ts
 *   npm run audit:routing
 */

import {
    classifyPrompt,
    formatDecisionSummary,
    loadLevelRegistry,
    loadRoutingRegistry,
    validateLevelRegistry,
    validateRoutingRegistry,
} from './lib/aiControlPlaneRegistry';

interface PromptExpectation {
    label: string;
    prompt: string;
    expectedDomains: string[];
    expectedWebPolicy: 'required' | 'conditional' | 'not-needed';
    expectCapabilityGap: boolean;
}

const EXPECTATIONS: PromptExpectation[] = [
    {
        label: 'repo-local',
        prompt: 'Refactor TypeScript module interno e aggiorna i caller nel repo',
        expectedDomains: ['repo-code'],
        expectedWebPolicy: 'not-needed',
        expectCapabilityGap: false,
    },
    {
        label: 'recent-library-provider',
        prompt: 'Aggiorna la libreria provider API e verifica breaking changes e best practice recenti',
        expectedDomains: ['recent-library-provider'],
        expectedWebPolicy: 'required',
        expectCapabilityGap: false,
    },
    {
        label: 'external-live-state',
        prompt: 'Controlla lo stato live di produzione su Supabase e Sentry oggi',
        expectedDomains: ['external-live-state'],
        expectedWebPolicy: 'conditional',
        expectCapabilityGap: false,
    },
    {
        label: 'browser-linkedin',
        prompt: 'Debugga il click Playwright su LinkedIn e valuta rischio anti-ban su timing e sessione',
        expectedDomains: ['antiban-linkedin', 'browser-ui'],
        expectedWebPolicy: 'conditional',
        expectCapabilityGap: false,
    },
    {
        label: 'ambiguous',
        prompt: 'Fammi una cosa generica senza contesto',
        expectedDomains: [],
        expectedWebPolicy: 'not-needed',
        expectCapabilityGap: true,
    },
];

function run(): void {
    console.log('\n=== Capability Routing Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    const routingRegistry = loadRoutingRegistry();
    const levelRegistry = loadLevelRegistry();

    const routingIssues = validateRoutingRegistry(routingRegistry);
    const levelIssues = validateLevelRegistry(levelRegistry);
    const issues = [...routingIssues, ...levelIssues];

    if (issues.length > 0) {
        console.log('--- Problemi di validazione registri ---');
        for (const issue of issues) {
            console.log(`❌ [${issue.scope}] ${issue.message}`);
        }
        console.log('');
        process.exit(1);
    }

    console.log('--- Registro routing ---');
    console.log(`✅ Capability attive: ${routingRegistry.capabilities.length}`);
    console.log(`✅ Domini coperti: ${routingRegistry.domains.length}`);
    console.log('');

    console.log('--- Smoke prompt canonici ---');
    const smokeFailures: string[] = [];

    for (const expectation of EXPECTATIONS) {
        const decision = classifyPrompt(expectation.prompt, routingRegistry, levelRegistry);
        const matchedDomainIds = decision.matchedDomains.map((match) => match.domain.domainId);
        const domainsOk = expectation.expectedDomains.every((domainId) => matchedDomainIds.includes(domainId));
        const webPolicyOk = decision.webPolicy === expectation.expectedWebPolicy;
        const capabilityGapOk = decision.capabilityGap === expectation.expectCapabilityGap;

        const passed = domainsOk && webPolicyOk && capabilityGapOk;
        const icon = passed ? '✅' : '❌';
        console.log(`${icon} ${expectation.label}`);
        console.log(`   ${formatDecisionSummary(decision, routingRegistry).join(' | ')}`);

        if (!passed) {
            smokeFailures.push(
                `${expectation.label}: atteso domains=${expectation.expectedDomains.join(',') || 'none'} web=${expectation.expectedWebPolicy} gap=${expectation.expectCapabilityGap}, ottenuto domains=${matchedDomainIds.join(',') || 'none'} web=${decision.webPolicy} gap=${decision.capabilityGap}`,
            );
        }
    }

    if (smokeFailures.length > 0) {
        console.log('\n--- Failures ---');
        for (const failure of smokeFailures) {
            console.log(`❌ ${failure}`);
        }
        console.log('');
        process.exit(1);
    }

    console.log('\n✅ Routing registry valido e smoke prompt coerenti.\n');
}

run();
