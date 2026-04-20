import { describe, expect, it } from 'vitest';

import {
    classifyPrompt,
    loadLevelRegistry,
    loadRoutingRegistry,
    validateLevelRegistry,
    validateRoutingRegistry,
    type LevelRegistry,
    type RoutingRegistry,
} from '../scripts/lib/aiControlPlaneRegistry';

function cloneRoutingRegistry(): RoutingRegistry {
    return JSON.parse(JSON.stringify(loadRoutingRegistry())) as RoutingRegistry;
}

function cloneLevelRegistry(): LevelRegistry {
    return JSON.parse(JSON.stringify(loadLevelRegistry())) as LevelRegistry;
}

describe('ai control plane registry', () => {
    it('classifica un prompt repo-local senza richiedere web', () => {
        const decision = classifyPrompt(
            'Refactor TypeScript module interno e aggiorna caller e contratti nel repo',
            loadRoutingRegistry(),
            loadLevelRegistry(),
        );

        expect(decision.capabilityGap).toBe(false);
        expect(decision.matchedDomains.map((match) => match.domain.domainId)).toContain('repo-code');
        expect(decision.webPolicy).toBe('not-needed');
    });

    it('classifica libreria/provider recente con web richiesto', () => {
        const decision = classifyPrompt(
            'Aggiorna SDK provider API e controlla breaking changes e best practice recenti',
            loadRoutingRegistry(),
            loadLevelRegistry(),
        );

        expect(decision.capabilityGap).toBe(false);
        expect(decision.matchedDomains[0]?.domain.domainId).toBe('recent-library-provider');
        expect(decision.webPolicy).toBe('required');
    });

    it('classifica stato esterno come live-state', () => {
        const decision = classifyPrompt(
            'Controlla lo stato live di produzione su Supabase e Sentry oggi',
            loadRoutingRegistry(),
            loadLevelRegistry(),
        );

        expect(decision.capabilityGap).toBe(false);
        expect(decision.matchedDomains.map((match) => match.domain.domainId)).toContain('external-live-state');
        expect(decision.sourceOfTruth).toContain('live-mcp-or-tool');
    });

    it('classifica browser LinkedIn con browser tool e anti-ban', () => {
        const decision = classifyPrompt(
            'Debugga il click Playwright su LinkedIn e valuta rischio anti-ban su timing e sessione',
            loadRoutingRegistry(),
            loadLevelRegistry(),
        );

        const matchedDomainIds = decision.matchedDomains.map((match) => match.domain.domainId);
        expect(decision.capabilityGap).toBe(false);
        expect(matchedDomainIds).toContain('browser-ui');
        expect(matchedDomainIds).toContain('antiban-linkedin');
    });

    it('dichiara capability gap su prompt ambiguo', () => {
        const decision = classifyPrompt('Fammi una cosa generica senza contesto', loadRoutingRegistry(), loadLevelRegistry());
        expect(decision.capabilityGap).toBe(true);
        expect(decision.matchedDomains).toHaveLength(0);
    });

    it('fallisce con capability sconosciuta nel routing registry', () => {
        const registry = cloneRoutingRegistry();
        const [firstDomain] = registry.domains;
        expect(firstDomain).toBeDefined();
        if (!firstDomain) {
            throw new Error('routing registry privo di domini');
        }
        firstDomain.primaryCapabilities = ['capability-che-non-esiste'];

        const issues = validateRoutingRegistry(registry);
        expect(issues.some((issue) => issue.message.includes('primaryCapabilities'))).toBe(true);
    });

    it('fallisce con domain duplicato nel routing registry', () => {
        const registry = cloneRoutingRegistry();
        registry.domains.push(JSON.parse(JSON.stringify(registry.domains[0])));

        const issues = validateRoutingRegistry(registry);
        expect(issues.some((issue) => issue.message.includes('domain duplicato'))).toBe(true);
    });

    it('fallisce con sourceOfTruth mancante nel routing registry', () => {
        const registry = cloneRoutingRegistry() as RoutingRegistry & {
            domains: Array<Record<string, unknown>>;
        };
        (registry.domains[0] as Record<string, unknown>).sourceOfTruth = undefined;

        const issues = validateRoutingRegistry(registry as unknown as RoutingRegistry);
        expect(issues.some((issue) => issue.message.includes('sourceOfTruth'))).toBe(true);
    });

    it('fallisce con livello incompleto nel level registry', () => {
        const registry = cloneLevelRegistry();
        registry.levels = registry.levels.filter((level) => level.level !== 'L4');

        const issues = validateLevelRegistry(registry);
        expect(issues.some((issue) => issue.message.includes('livello obbligatorio mancante: L4'))).toBe(true);
    });
});
