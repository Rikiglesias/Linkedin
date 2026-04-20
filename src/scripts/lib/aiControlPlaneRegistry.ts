import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export type CapabilityKind = 'repo' | 'web' | 'mcp' | 'hook' | 'skill' | 'script' | 'workflow';
export type WebPolicy = 'required' | 'conditional' | 'not-needed';
export type PreferredEnvironment = 'claude-code' | 'codex' | 'either' | 'n8n';
export type SourceOfTruth =
    | 'repo'
    | 'official-web-docs'
    | 'live-mcp-or-tool'
    | 'browser-automation'
    | 'database-live'
    | 'git-state'
    | 'memory-files'
    | 'n8n-live';
export type TaskClass = 'quick-fix' | 'bug' | 'feature/refactor';

export interface CapabilityEntry {
    id: string;
    kind: CapabilityKind;
    label: string;
    status: 'active';
    environments: PreferredEnvironment[];
    notes: string;
}

export interface DomainRoutingEntry {
    domainId: string;
    intentPatterns: string[];
    sourceOfTruth: SourceOfTruth;
    webPolicy: WebPolicy;
    primaryCapabilities: string[];
    fallbackCapabilities: string[];
    preferredEnvironment: PreferredEnvironment;
    notes: string;
}

export interface RoutingRegistry {
    capabilities: CapabilityEntry[];
    domains: DomainRoutingEntry[];
}

export interface LevelDefinition {
    level: 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'L9';
    appliesTo: TaskClass[];
    focusChecks: string[];
    expectedEvidence: string[];
    advisoryPrompt: string;
    currentPrimitive: 'runtime-brief' | 'advisory-hook' | 'audit-script' | 'audit+hook' | 'skill';
    promotionTarget: 'blocking-hook' | 'audit-script' | 'hook+audit' | 'hook+skill';
}

export interface LevelRegistry {
    levels: LevelDefinition[];
}

export interface ValidationIssue {
    scope: string;
    message: string;
}

export interface DomainMatch {
    domain: DomainRoutingEntry;
    score: number;
}

export interface RoutingDecision {
    prompt: string;
    taskClass: TaskClass;
    matchedDomains: DomainMatch[];
    sourceOfTruth: string[];
    webPolicy: WebPolicy;
    preferredEnvironment: PreferredEnvironment;
    useCapabilities: string[];
    avoidCapabilities: string[];
    focusLevels: LevelDefinition[];
    capabilityGap: boolean;
}

const ROUTING_REGISTRY_PATH = resolve('docs', 'tracking', 'AI_CAPABILITY_ROUTING.json');
const LEVEL_REGISTRY_PATH = resolve('docs', 'tracking', 'AI_LEVEL_ENFORCEMENT.json');

const CAPABILITY_KIND_SET = new Set<CapabilityKind>(['repo', 'web', 'mcp', 'hook', 'skill', 'script', 'workflow']);
const WEB_POLICY_SET = new Set<WebPolicy>(['required', 'conditional', 'not-needed']);
const ENVIRONMENT_SET = new Set<PreferredEnvironment>(['claude-code', 'codex', 'either', 'n8n']);
const SOURCE_OF_TRUTH_SET = new Set<SourceOfTruth>([
    'repo',
    'official-web-docs',
    'live-mcp-or-tool',
    'browser-automation',
    'database-live',
    'git-state',
    'memory-files',
    'n8n-live',
]);
const TASK_CLASS_SET = new Set<TaskClass>(['quick-fix', 'bug', 'feature/refactor']);
const LEVEL_SEQUENCE: Array<LevelDefinition['level']> = ['L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'];

function readJsonFile<T>(filePath: string): T {
    if (!existsSync(filePath)) {
        throw new Error(`File non trovato: ${filePath}`);
    }

    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function pushIssue(issues: ValidationIssue[], scope: string, condition: unknown, message: string): void {
    if (!condition) {
        issues.push({ scope, message });
    }
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function normalizePrompt(prompt: string): string {
    return prompt.toLowerCase();
}

function countPatternMatches(prompt: string, patterns: string[]): number {
    let score = 0;
    for (const pattern of patterns) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(prompt)) {
            score += 1;
        }
    }
    return score;
}

export function loadRoutingRegistry(): RoutingRegistry {
    return readJsonFile<RoutingRegistry>(ROUTING_REGISTRY_PATH);
}

export function loadLevelRegistry(): LevelRegistry {
    return readJsonFile<LevelRegistry>(LEVEL_REGISTRY_PATH);
}

export function validateRoutingRegistry(registry: RoutingRegistry): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    pushIssue(issues, 'routing', Array.isArray(registry.capabilities), 'capabilities deve essere un array');
    pushIssue(issues, 'routing', Array.isArray(registry.domains), 'domains deve essere un array');

    const capabilityIds = new Set<string>();
    for (const capability of registry.capabilities ?? []) {
        const scope = `capability:${capability.id ?? 'missing-id'}`;
        pushIssue(issues, scope, typeof capability.id === 'string' && capability.id.trim().length > 0, 'id mancante');
        pushIssue(
            issues,
            scope,
            typeof capability.kind === 'string' && CAPABILITY_KIND_SET.has(capability.kind),
            `kind non valido: ${String(capability.kind)}`,
        );
        pushIssue(
            issues,
            scope,
            typeof capability.label === 'string' && capability.label.trim().length > 0,
            'label mancante',
        );
        pushIssue(issues, scope, capability.status === 'active', 'status deve essere "active"');
        pushIssue(
            issues,
            scope,
            Array.isArray(capability.environments) &&
                capability.environments.length > 0 &&
                capability.environments.every((environment) => ENVIRONMENT_SET.has(environment)),
            'environments deve contenere solo valori validi',
        );
        pushIssue(
            issues,
            scope,
            typeof capability.notes === 'string' && capability.notes.trim().length > 0,
            'notes mancante',
        );

        if (typeof capability.id === 'string') {
            pushIssue(issues, scope, !capabilityIds.has(capability.id), `capability duplicata: ${capability.id}`);
            capabilityIds.add(capability.id);
        }
    }

    const domainIds = new Set<string>();
    for (const domain of registry.domains ?? []) {
        const scope = `domain:${domain.domainId ?? 'missing-id'}`;
        pushIssue(
            issues,
            scope,
            typeof domain.domainId === 'string' && domain.domainId.trim().length > 0,
            'domainId mancante',
        );
        pushIssue(
            issues,
            scope,
            Array.isArray(domain.intentPatterns) &&
                domain.intentPatterns.length > 0 &&
                domain.intentPatterns.every((pattern) => typeof pattern === 'string' && pattern.trim().length > 0),
            'intentPatterns deve contenere almeno un pattern valido',
        );
        pushIssue(
            issues,
            scope,
            typeof domain.sourceOfTruth === 'string' && SOURCE_OF_TRUTH_SET.has(domain.sourceOfTruth),
            `sourceOfTruth non valido: ${String(domain.sourceOfTruth)}`,
        );
        pushIssue(
            issues,
            scope,
            typeof domain.webPolicy === 'string' && WEB_POLICY_SET.has(domain.webPolicy),
            `webPolicy non valido: ${String(domain.webPolicy)}`,
        );
        pushIssue(
            issues,
            scope,
            Array.isArray(domain.primaryCapabilities) &&
                domain.primaryCapabilities.length > 0 &&
                domain.primaryCapabilities.every((capabilityId) => capabilityIds.has(capabilityId)),
            'primaryCapabilities contiene capability mancanti o non valide',
        );
        pushIssue(
            issues,
            scope,
            Array.isArray(domain.fallbackCapabilities) &&
                domain.fallbackCapabilities.length > 0 &&
                domain.fallbackCapabilities.every((capabilityId) => capabilityIds.has(capabilityId)),
            'fallbackCapabilities contiene capability mancanti o non valide',
        );
        pushIssue(
            issues,
            scope,
            typeof domain.preferredEnvironment === 'string' && ENVIRONMENT_SET.has(domain.preferredEnvironment),
            `preferredEnvironment non valido: ${String(domain.preferredEnvironment)}`,
        );
        pushIssue(issues, scope, typeof domain.notes === 'string' && domain.notes.trim().length > 0, 'notes mancante');

        if (typeof domain.domainId === 'string') {
            pushIssue(issues, scope, !domainIds.has(domain.domainId), `domain duplicato: ${domain.domainId}`);
            domainIds.add(domain.domainId);
        }
    }

    const requiredDomains = [
        'repo-code',
        'recent-library-provider',
        'external-live-state',
        'browser-ui',
        'database-persistence',
        'git-closure',
        'memory-handoff',
        'n8n-orchestration',
        'antiban-linkedin',
        'debugging',
        'testing',
        'review-security',
    ];

    for (const domainId of requiredDomains) {
        pushIssue(
            issues,
            'routing',
            registry.domains.some((domain) => domain.domainId === domainId),
            `dominio obbligatorio mancante: ${domainId}`,
        );
    }

    return issues;
}

export function validateLevelRegistry(registry: LevelRegistry): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    pushIssue(issues, 'levels', Array.isArray(registry.levels), 'levels deve essere un array');

    const seenLevels = new Set<string>();
    for (const level of registry.levels ?? []) {
        const scope = `level:${level.level ?? 'missing-level'}`;
        pushIssue(
            issues,
            scope,
            typeof level.level === 'string' && LEVEL_SEQUENCE.includes(level.level),
            `level non valido: ${String(level.level)}`,
        );
        pushIssue(
            issues,
            scope,
            Array.isArray(level.appliesTo) &&
                level.appliesTo.length > 0 &&
                level.appliesTo.every((taskClass) => TASK_CLASS_SET.has(taskClass)),
            'appliesTo deve contenere solo task class validi',
        );
        pushIssue(
            issues,
            scope,
            Array.isArray(level.focusChecks) &&
                level.focusChecks.length > 0 &&
                level.focusChecks.every((check) => typeof check === 'string' && check.trim().length > 0),
            'focusChecks deve contenere almeno un check valido',
        );
        pushIssue(
            issues,
            scope,
            Array.isArray(level.expectedEvidence) &&
                level.expectedEvidence.length > 0 &&
                level.expectedEvidence.every((evidence) => typeof evidence === 'string' && evidence.trim().length > 0),
            'expectedEvidence deve contenere almeno un elemento valido',
        );
        pushIssue(
            issues,
            scope,
            typeof level.advisoryPrompt === 'string' && level.advisoryPrompt.trim().length > 0,
            'advisoryPrompt mancante',
        );
        pushIssue(
            issues,
            scope,
            ['runtime-brief', 'advisory-hook', 'audit-script', 'audit+hook', 'skill'].includes(level.currentPrimitive),
            `currentPrimitive non valido: ${String(level.currentPrimitive)}`,
        );
        pushIssue(
            issues,
            scope,
            ['blocking-hook', 'audit-script', 'hook+audit', 'hook+skill'].includes(level.promotionTarget),
            `promotionTarget non valido: ${String(level.promotionTarget)}`,
        );

        if (typeof level.level === 'string') {
            pushIssue(issues, scope, !seenLevels.has(level.level), `livello duplicato: ${level.level}`);
            seenLevels.add(level.level);
        }
    }

    for (const requiredLevel of LEVEL_SEQUENCE) {
        pushIssue(
            issues,
            'levels',
            registry.levels.some((level) => level.level === requiredLevel),
            `livello obbligatorio mancante: ${requiredLevel}`,
        );
    }

    return issues;
}

export function classifyTaskClass(prompt: string): TaskClass {
    const normalizedPrompt = normalizePrompt(prompt);

    if (
        /quick[\s-]?fix|piccolo fix|one[\s-]?liner|one liner|typo|rename|docs[\s-]?only|solo docs|hotfix piccolo/.test(
            normalizedPrompt,
        )
    ) {
        return 'quick-fix';
    }

    if (/\bbug\b|errore|crash|broken|fix\b|stack trace|traceback|failure|fail|regression|rott/.test(normalizedPrompt)) {
        return 'bug';
    }

    return 'feature/refactor';
}

function resolveWebPolicy(domains: DomainRoutingEntry[]): WebPolicy {
    if (domains.some((domain) => domain.webPolicy === 'required')) {
        return 'required';
    }
    if (domains.some((domain) => domain.webPolicy === 'conditional')) {
        return 'conditional';
    }
    return 'not-needed';
}

function deriveAvoidCapabilities(domains: DomainRoutingEntry[], webPolicy: WebPolicy): string[] {
    const avoids: string[] = [];
    if (webPolicy === 'not-needed') {
        avoids.push('ricerca web non necessaria');
    }
    if (domains.some((domain) => domain.domainId === 'external-live-state')) {
        avoids.push('repo come fonte di stato live');
        avoids.push('web come sostituto dello stato reale');
    }
    if (domains.some((domain) => domain.domainId === 'n8n-orchestration')) {
        avoids.push('json n8n del repo come prova di stato live');
    }
    if (domains.some((domain) => domain.domainId === 'recent-library-provider')) {
        avoids.push('knowledge cutoff senza docs ufficiali');
    }
    return unique(avoids).slice(0, 3);
}

function resolvePreferredEnvironment(domains: DomainRoutingEntry[]): PreferredEnvironment {
    if (domains.length === 0) {
        return 'either';
    }

    const first = domains[0].preferredEnvironment;
    if (domains.every((domain) => domain.preferredEnvironment === first)) {
        return first;
    }

    return domains[0].preferredEnvironment;
}

export function getFocusLevels(registry: LevelRegistry, taskClass: TaskClass): LevelDefinition[] {
    return LEVEL_SEQUENCE.map((levelCode) => registry.levels.find((level) => level.level === levelCode))
        .filter((level): level is LevelDefinition => Boolean(level))
        .filter((level) => level.appliesTo.includes(taskClass));
}

export function classifyPrompt(
    prompt: string,
    routingRegistry: RoutingRegistry,
    levelRegistry: LevelRegistry,
): RoutingDecision {
    const normalizedPrompt = normalizePrompt(prompt);
    const taskClass = classifyTaskClass(prompt);
    const matchedDomains = routingRegistry.domains
        .map((domain) => ({
            domain,
            score: countPatternMatches(normalizedPrompt, domain.intentPatterns),
        }))
        .filter((match) => match.score >= 2)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3);

    const domains = matchedDomains.map((match) => match.domain);
    const useCapabilities = unique(domains.flatMap((domain) => domain.primaryCapabilities)).slice(0, 3);
    const webPolicy = resolveWebPolicy(domains);
    const focusLevels = getFocusLevels(levelRegistry, taskClass);

    return {
        prompt,
        taskClass,
        matchedDomains,
        sourceOfTruth: unique(domains.map((domain) => domain.sourceOfTruth)),
        webPolicy,
        preferredEnvironment: resolvePreferredEnvironment(domains),
        useCapabilities,
        avoidCapabilities: deriveAvoidCapabilities(domains, webPolicy),
        focusLevels,
        capabilityGap: matchedDomains.length === 0,
    };
}

export function formatDecisionSummary(decision: RoutingDecision, routingRegistry: RoutingRegistry): string[] {
    if (decision.capabilityGap) {
        return [
            `Task class: ${decision.taskClass}`,
            'Capability gap: routing non affidabile, non proporre una capability finta',
        ];
    }

    const capabilityLabelById = new Map(
        routingRegistry.capabilities.map((capability) => [capability.id, capability.label]),
    );

    return [
        `Task class: ${decision.taskClass}`,
        `Source of truth: ${decision.sourceOfTruth.join(', ')}`,
        `Web/docs: ${decision.webPolicy}`,
        `Capabilities da usare: ${decision.useCapabilities
            .map((capabilityId) => capabilityLabelById.get(capabilityId) ?? capabilityId)
            .join(', ')}`,
        `Capabilities da non usare: ${decision.avoidCapabilities.join(', ') || 'nessuna esclusione forte'}`,
        `Preferred environment: ${decision.preferredEnvironment}`,
        `L2-L9 focus: ${decision.focusLevels.map((level) => level.level).join(', ')}`,
    ];
}
