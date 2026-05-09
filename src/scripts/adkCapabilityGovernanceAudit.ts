/**
 * adkCapabilityGovernanceAudit.ts
 *
 * Verifica che il control plane AI abbia una governance ADK esplicita:
 * - layer Agent Development Kit presenti
 * - ogni capability del routing ha un placement ADK
 * - ogni placement dichiara trigger, limiti, decisione e verifica
 * - le candidate esterne restano "evaluate-before-install"
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

interface AdkLayer {
    id: string;
    label: string;
    requiredArtifacts: string[];
    globalScope?: string;
    projectScope?: string;
    standard: string;
}

interface ExternalSurface {
    id: string;
    label: string;
    standard: string;
}

interface PlacementRule {
    when: string;
    targetLayer: string;
    promotion: string;
}

interface CandidateExternalCapability {
    id: string;
    displayName: string;
    status: string;
    decision: string;
    evaluationRequired: string;
}

interface CapabilityPlacement {
    id: string;
    sourceRegistry: string;
    adkLayer: string;
    scope: string;
    primitive: string;
    domain: string;
    trigger: string;
    limits: string;
    decision: string;
    relationship: string;
    verification: string;
}

interface AdkGovernanceRegistry {
    schemaVersion: number;
    updated: string;
    purpose: string;
    adkModel: {
        name: string;
        coreLayers: AdkLayer[];
        externalSurfaces: ExternalSurface[];
    };
    placementPolicy: {
        rules: PlacementRule[];
        requiredCapabilityFields: string[];
    };
    candidateExternalCapabilities: CandidateExternalCapability[];
    capabilityPlacements: CapabilityPlacement[];
}

interface RoutingRegistry {
    capabilities: Array<{ id: string }>;
}

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

const GOVERNANCE_PATH = resolve('docs', 'tracking', 'AI_ADK_CAPABILITY_GOVERNANCE.json');
const ROUTING_PATH = resolve('docs', 'tracking', 'AI_CAPABILITY_ROUTING.json');

const REQUIRED_CORE_LAYERS = ['rules-memory', 'skill', 'hook', 'subagent', 'plugin-distribution'];
const REQUIRED_EXTERNAL_SURFACES = ['mcp-external', 'script-audit', 'workflow-automation', 'source-registry'];
const REQUIRED_CANDIDATES = ['caveman', 'leanctx', 'simdex', 'contact-skills'];
const REQUIRED_SKILL_ARTIFACTS = ['SKILL.md', 'scripts/', 'templates/', 'assets/'];
const REQUIRED_PLUGIN_ARTIFACTS = ['plugin.json', 'manifest', 'version', 'provenance', 'team install'];
const REQUIRED_SUBAGENT_ARTIFACTS = ['one job', 'own context', 'own tools', 'single result'];
const REQUIRED_HOOK_ARTIFACTS = ['PreToolUse', 'PostToolUse', 'SessionStart'];
const ALLOWED_DECISIONS = new Set(['keep', 'merge', 'remove', 'promote', 'demote', 'evaluate']);

function readJson<T>(path: string): T {
    if (!existsSync(path)) {
        throw new Error(`File non trovato: ${path}`);
    }

    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function findDuplicateIds(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const value of values) {
        if (seen.has(value)) {
            duplicates.add(value);
        }
        seen.add(value);
    }

    return [...duplicates].sort();
}

function missing(values: string[], required: string[]): string[] {
    return required.filter((requiredValue) => !values.includes(requiredValue));
}

function containsAll(values: string[], required: string[]): string[] {
    const haystack = values.join('\n');
    return required.filter((requiredValue) => !haystack.includes(requiredValue));
}

function nonEmptyString(value: string): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function checkLayerStandards(registry: AdkGovernanceRegistry): CheckResult {
    const coreLayerIds = registry.adkModel.coreLayers.map((layer) => layer.id);
    const externalSurfaceIds = registry.adkModel.externalSurfaces.map((surface) => surface.id);
    const missingCoreLayers = missing(coreLayerIds, REQUIRED_CORE_LAYERS);
    const missingExternalSurfaces = missing(externalSurfaceIds, REQUIRED_EXTERNAL_SURFACES);

    const skillLayer = registry.adkModel.coreLayers.find((layer) => layer.id === 'skill');
    const pluginLayer = registry.adkModel.coreLayers.find((layer) => layer.id === 'plugin-distribution');
    const subagentLayer = registry.adkModel.coreLayers.find((layer) => layer.id === 'subagent');
    const hookLayer = registry.adkModel.coreLayers.find((layer) => layer.id === 'hook');

    const missingSkillArtifacts = containsAll(skillLayer?.requiredArtifacts ?? [], REQUIRED_SKILL_ARTIFACTS);
    const missingPluginArtifacts = containsAll(pluginLayer?.requiredArtifacts ?? [], REQUIRED_PLUGIN_ARTIFACTS);
    const missingSubagentArtifacts = containsAll(subagentLayer?.requiredArtifacts ?? [], REQUIRED_SUBAGENT_ARTIFACTS);
    const missingHookArtifacts = containsAll(hookLayer?.requiredArtifacts ?? [], REQUIRED_HOOK_ARTIFACTS);

    const issues = [
        missingCoreLayers.length > 0 ? `layer core mancanti: ${missingCoreLayers.join(', ')}` : '',
        missingExternalSurfaces.length > 0 ? `surface esterne mancanti: ${missingExternalSurfaces.join(', ')}` : '',
        missingSkillArtifacts.length > 0 ? `artifact skill mancanti: ${missingSkillArtifacts.join(', ')}` : '',
        missingPluginArtifacts.length > 0 ? `artifact plugin mancanti: ${missingPluginArtifacts.join(', ')}` : '',
        missingSubagentArtifacts.length > 0 ? `artifact subagent mancanti: ${missingSubagentArtifacts.join(', ')}` : '',
        missingHookArtifacts.length > 0 ? `artifact hook mancanti: ${missingHookArtifacts.join(', ')}` : '',
    ].filter(Boolean);

    if (issues.length > 0) {
        return {
            name: 'ADK layer standards',
            passed: false,
            detail: issues.join(' | '),
        };
    }

    return {
        name: 'ADK layer standards',
        passed: true,
        detail: '5 layer ADK e surface esterne hanno artifact/standard minimi.',
    };
}

function checkCapabilityPlacements(registry: AdkGovernanceRegistry, routing: RoutingRegistry): CheckResult {
    const layerIds = new Set([
        ...registry.adkModel.coreLayers.map((layer) => layer.id),
        ...registry.adkModel.externalSurfaces.map((surface) => surface.id),
    ]);
    const placementIds = registry.capabilityPlacements.map((placement) => placement.id);
    const duplicateIds = findDuplicateIds(placementIds);
    const routingIds = routing.capabilities.map((capability) => capability.id);
    const missingRoutingPlacements = missing(placementIds, routingIds);

    const incomplete = registry.capabilityPlacements
        .map((placement) => {
            const missingFields = registry.placementPolicy.requiredCapabilityFields.filter((fieldName) => {
                const value = placement[fieldName as keyof CapabilityPlacement];
                return typeof value !== 'string' || value.trim().length === 0;
            });

            if (!layerIds.has(placement.adkLayer)) {
                missingFields.push(`layer non valido: ${placement.adkLayer}`);
            }

            if (!ALLOWED_DECISIONS.has(placement.decision)) {
                missingFields.push(`decision non valida: ${placement.decision}`);
            }

            return { id: placement.id, missingFields };
        })
        .filter((entry) => entry.missingFields.length > 0);

    const issues = [
        duplicateIds.length > 0 ? `placement duplicati: ${duplicateIds.join(', ')}` : '',
        missingRoutingPlacements.length > 0
            ? `capability routing senza placement ADK: ${missingRoutingPlacements.join(', ')}`
            : '',
        incomplete.length > 0
            ? `placement incompleti: ${incomplete
                  .map((entry) => `${entry.id}(${entry.missingFields.join(', ')})`)
                  .join('; ')}`
            : '',
    ].filter(Boolean);

    if (issues.length > 0) {
        return {
            name: 'Capability placement coverage',
            passed: false,
            detail: issues.join(' | '),
        };
    }

    return {
        name: 'Capability placement coverage',
        passed: true,
        detail: `${routingIds.length} capability del routing hanno placement ADK; ${placementIds.length} placement totali.`,
    };
}

function checkCandidateExternalCapabilities(registry: AdkGovernanceRegistry): CheckResult {
    const candidateIds = registry.candidateExternalCapabilities.map((candidate) => candidate.id);
    const missingCandidates = missing(candidateIds, REQUIRED_CANDIDATES);
    const unsafeCandidates = registry.candidateExternalCapabilities.filter(
        (candidate) =>
            candidate.status !== 'candidate' ||
            candidate.decision !== 'evaluate-before-install' ||
            !nonEmptyString(candidate.evaluationRequired),
    );

    const issues = [
        missingCandidates.length > 0 ? `candidate mancanti: ${missingCandidates.join(', ')}` : '',
        unsafeCandidates.length > 0
            ? `candidate senza gate evaluate-before-install: ${unsafeCandidates
                  .map((candidate) => candidate.id)
                  .join(', ')}`
            : '',
    ].filter(Boolean);

    if (issues.length > 0) {
        return {
            name: 'Candidate esterne non installate alla cieca',
            passed: false,
            detail: issues.join(' | '),
        };
    }

    return {
        name: 'Candidate esterne non installate alla cieca',
        passed: true,
        detail: 'Caveman, LeanCTX, SIMDex e Contact Skills sono candidate con valutazione obbligatoria.',
    };
}

function checkLayerCoverageByPlacement(registry: AdkGovernanceRegistry): CheckResult {
    const placementLayers = new Set(registry.capabilityPlacements.map((placement) => placement.adkLayer));
    const requiredCoverage = [...REQUIRED_CORE_LAYERS, 'mcp-external', 'script-audit', 'workflow-automation'];
    const missingCoverage = requiredCoverage.filter((layerId) => !placementLayers.has(layerId));

    if (missingCoverage.length > 0) {
        return {
            name: 'Layer coverage by capability',
            passed: false,
            detail: `Nessun placement per: ${missingCoverage.join(', ')}`,
        };
    }

    return {
        name: 'Layer coverage by capability',
        passed: true,
        detail: 'Tutti i layer/surface rilevanti hanno almeno una capability classificata.',
    };
}

function run(): void {
    const governance = readJson<AdkGovernanceRegistry>(GOVERNANCE_PATH);
    const routing = readJson<RoutingRegistry>(ROUTING_PATH);

    const checks: CheckResult[] = [
        checkLayerStandards(governance),
        checkCapabilityPlacements(governance, routing),
        checkCandidateExternalCapabilities(governance),
        checkLayerCoverageByPlacement(governance),
    ];

    console.log('\n=== ADK Capability Governance Audit ===\n');

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
