/**
 * jsonSchemasAudit.ts — Audit dei 4 registri JSON canonici del sistema AI/ADK
 *
 * Valida sintassi JSON + presenza chiavi top-level richieste + schema minimo per:
 *  1. .claude-plugin/plugin.json
 *  2. docs/tracking/AI_CAPABILITY_ROUTING.json
 *  3. docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json
 *  4. docs/tracking/AI_LEVEL_ENFORCEMENT.json
 *
 * Uso:
 *   npx ts-node src/scripts/jsonSchemasAudit.ts
 *   npm run audit:json-schemas
 *
 * Exit code 0 se tutti i 4 file passano, 1 se almeno uno fallisce.
 */

import * as fs from 'fs';
import * as path from 'path';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
    [key: string]: JsonValue;
}

interface SchemaIssue {
    file: string;
    severity: 'error' | 'warn';
    message: string;
}

interface SchemaCheck {
    relativePath: string;
    requiredTopLevelKeys: string[];
    validator: (data: JsonObject, issues: SchemaIssue[]) => void;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function isJsonObject(v: unknown): v is JsonObject {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJsonSafe(absPath: string, issues: SchemaIssue[]): JsonObject | null {
    if (!fs.existsSync(absPath)) {
        issues.push({ file: absPath, severity: 'error', message: 'file mancante' });
        return null;
    }
    const raw = fs.readFileSync(absPath, 'utf8');
    try {
        const parsed = JSON.parse(raw);
        if (!isJsonObject(parsed)) {
            issues.push({ file: absPath, severity: 'error', message: 'root deve essere object JSON' });
            return null;
        }
        return parsed;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        issues.push({ file: absPath, severity: 'error', message: `JSON non valido: ${msg}` });
        return null;
    }
}

function validatePluginJson(data: JsonObject, issues: SchemaIssue[]): void {
    const rel = '.claude-plugin/plugin.json';
    if (typeof data.name !== 'string' || data.name.length === 0) {
        issues.push({ file: rel, severity: 'error', message: 'name deve essere stringa non vuota' });
    }
    if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+/.test(data.version)) {
        issues.push({ file: rel, severity: 'error', message: 'version deve seguire semver (X.Y.Z)' });
    }
    if (typeof data.description !== 'string') {
        issues.push({ file: rel, severity: 'error', message: 'description mancante' });
    }
    if (data.$schema !== undefined) {
        issues.push({
            file: rel,
            severity: 'error',
            message: '$schema non deve essere presente: Claude Code 2026 non ha schema pubblico per plugin.json',
        });
    }
    if (!isJsonObject(data.contents)) {
        issues.push({ file: rel, severity: 'error', message: 'contents deve essere object' });
    } else {
        const layers = ['rules', 'skills', 'hooks'];
        for (const layer of layers) {
            if (!data.contents[layer]) {
                issues.push({ file: rel, severity: 'warn', message: `contents.${layer} assente (atteso per ADK 5-layer)` });
            }
        }
    }
    if (!isJsonObject(data.compatibility)) {
        issues.push({ file: rel, severity: 'error', message: 'compatibility object mancante' });
    }
}

function validateRoutingJson(data: JsonObject, issues: SchemaIssue[]): void {
    const rel = 'docs/tracking/AI_CAPABILITY_ROUTING.json';
    if (!Array.isArray(data.capabilities)) {
        issues.push({ file: rel, severity: 'error', message: 'capabilities deve essere array' });
        return;
    }
    if (!Array.isArray(data.domains)) {
        issues.push({ file: rel, severity: 'error', message: 'domains deve essere array' });
        return;
    }
    const validKinds = new Set(['repo', 'web', 'cli', 'mcp', 'tool', 'skill', 'plugin', 'hook', 'script', 'workflow', 'agent']);
    const validStatuses = new Set(['active', 'planned', 'deprecated', 'experimental', 'candidate', 'missing']);
    const seenIds = new Set<string>();
    for (let i = 0; i < data.capabilities.length; i++) {
        const cap = data.capabilities[i];
        const tag = `capabilities[${i}]`;
        if (!isJsonObject(cap)) {
            issues.push({ file: rel, severity: 'error', message: `${tag} deve essere object` });
            continue;
        }
        if (typeof cap.id !== 'string') {
            issues.push({ file: rel, severity: 'error', message: `${tag}.id mancante o non stringa` });
            continue;
        }
        if (seenIds.has(cap.id)) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.id duplicato: ${cap.id}` });
        }
        seenIds.add(cap.id);
        if (typeof cap.kind !== 'string' || !validKinds.has(cap.kind)) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.kind invalido: ${String(cap.kind)}` });
        }
        if (typeof cap.status !== 'string' || !validStatuses.has(cap.status)) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.status invalido: ${String(cap.status)}` });
        }
        if (!Array.isArray(cap.environments)) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.environments deve essere array` });
        }
    }
    const seenDomainIds = new Set<string>();
    for (let i = 0; i < data.domains.length; i++) {
        const d = data.domains[i];
        const tag = `domains[${i}]`;
        if (!isJsonObject(d)) {
            issues.push({ file: rel, severity: 'error', message: `${tag} deve essere object` });
            continue;
        }
        if (typeof d.domainId !== 'string') {
            issues.push({ file: rel, severity: 'error', message: `${tag}.domainId mancante` });
            continue;
        }
        if (seenDomainIds.has(d.domainId)) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.domainId duplicato: ${d.domainId}` });
        }
        seenDomainIds.add(d.domainId);
    }
}

function validateAdkJson(data: JsonObject, issues: SchemaIssue[]): void {
    const rel = 'docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json';
    if (typeof data.schemaVersion !== 'number') {
        issues.push({ file: rel, severity: 'error', message: 'schemaVersion deve essere numero' });
    }
    if (typeof data.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) {
        issues.push({ file: rel, severity: 'error', message: 'updated deve essere data YYYY-MM-DD' });
    }
    if (!isJsonObject(data.adkModel)) {
        issues.push({ file: rel, severity: 'error', message: 'adkModel object mancante' });
        return;
    }
    const adkModel = data.adkModel;
    if (!Array.isArray(adkModel.coreLayers)) {
        issues.push({ file: rel, severity: 'error', message: 'adkModel.coreLayers deve essere array' });
    } else {
        const expectedLayerIds = new Set(['rules-memory', 'skill', 'hook', 'subagent', 'plugin-distribution']);
        const foundLayerIds = new Set<string>();
        for (let i = 0; i < adkModel.coreLayers.length; i++) {
            const layer = adkModel.coreLayers[i];
            const tag = `adkModel.coreLayers[${i}]`;
            if (!isJsonObject(layer)) {
                issues.push({ file: rel, severity: 'error', message: `${tag} deve essere object` });
                continue;
            }
            if (typeof layer.id !== 'string') {
                issues.push({ file: rel, severity: 'error', message: `${tag}.id mancante` });
                continue;
            }
            foundLayerIds.add(layer.id);
            if (!layer.label || !layer.standard) {
                issues.push({ file: rel, severity: 'error', message: `${tag} richiede label e standard` });
            }
        }
        for (const expected of expectedLayerIds) {
            if (!foundLayerIds.has(expected)) {
                issues.push({ file: rel, severity: 'error', message: `coreLayers manca layer richiesto: ${expected}` });
            }
        }
    }
    if (!Array.isArray(data.capabilityPlacements)) {
        issues.push({ file: rel, severity: 'error', message: 'capabilityPlacements deve essere array' });
    }
}

function validateLevelJson(data: JsonObject, issues: SchemaIssue[]): void {
    const rel = 'docs/tracking/AI_LEVEL_ENFORCEMENT.json';
    if (!Array.isArray(data.levels)) {
        issues.push({ file: rel, severity: 'error', message: 'levels deve essere array' });
        return;
    }
    const validLevels = new Set(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9']);
    const foundLevels = new Set<string>();
    for (let i = 0; i < data.levels.length; i++) {
        const lvl = data.levels[i];
        const tag = `levels[${i}]`;
        if (!isJsonObject(lvl)) {
            issues.push({ file: rel, severity: 'error', message: `${tag} deve essere object` });
            continue;
        }
        if (typeof lvl.level !== 'string' || !validLevels.has(lvl.level)) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.level invalido: ${String(lvl.level)}` });
            continue;
        }
        if (foundLevels.has(lvl.level)) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.level duplicato: ${lvl.level}` });
        }
        foundLevels.add(lvl.level);
        if (!Array.isArray(lvl.focusChecks) || lvl.focusChecks.length === 0) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.focusChecks deve essere array non vuoto` });
        }
        if (!Array.isArray(lvl.expectedEvidence) || lvl.expectedEvidence.length === 0) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.expectedEvidence deve essere array non vuoto` });
        }
        if (typeof lvl.advisoryPrompt !== 'string' || lvl.advisoryPrompt.length === 0) {
            issues.push({ file: rel, severity: 'error', message: `${tag}.advisoryPrompt mancante` });
        }
    }
}

const CHECKS: SchemaCheck[] = [
    {
        relativePath: '.claude-plugin/plugin.json',
        requiredTopLevelKeys: ['name', 'version', 'description', 'contents', 'compatibility'],
        validator: validatePluginJson,
    },
    {
        relativePath: 'docs/tracking/AI_CAPABILITY_ROUTING.json',
        requiredTopLevelKeys: ['capabilities', 'domains'],
        validator: validateRoutingJson,
    },
    {
        relativePath: 'docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json',
        requiredTopLevelKeys: ['schemaVersion', 'updated', 'adkModel', 'capabilityPlacements'],
        validator: validateAdkJson,
    },
    {
        relativePath: 'docs/tracking/AI_LEVEL_ENFORCEMENT.json',
        requiredTopLevelKeys: ['levels'],
        validator: validateLevelJson,
    },
];

function run(): void {
    console.log('\n=== JSON Schemas Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    const allIssues: SchemaIssue[] = [];
    let passed = 0;

    for (const check of CHECKS) {
        const issuesBefore = allIssues.length;
        const absPath = path.join(REPO_ROOT, check.relativePath);
        const data = readJsonSafe(absPath, allIssues);
        if (!data) {
            console.log(`❌ ${check.relativePath} — JSON invalido o mancante`);
            continue;
        }
        for (const key of check.requiredTopLevelKeys) {
            if (!(key in data)) {
                allIssues.push({
                    file: check.relativePath,
                    severity: 'error',
                    message: `chiave top-level mancante: ${key}`,
                });
            }
        }
        check.validator(data, allIssues);

        const newIssues = allIssues.slice(issuesBefore);
        const errs = newIssues.filter((i) => i.severity === 'error');
        const warns = newIssues.filter((i) => i.severity === 'warn');

        if (errs.length === 0) {
            console.log(`✅ ${check.relativePath}${warns.length > 0 ? ` (${warns.length} warn)` : ''}`);
            passed += 1;
        } else {
            console.log(`❌ ${check.relativePath} (${errs.length} error${errs.length > 1 ? 's' : ''}${warns.length > 0 ? `, ${warns.length} warn` : ''})`);
        }
    }

    if (allIssues.length > 0) {
        console.log('\n--- Dettagli ---');
        for (const issue of allIssues) {
            const icon = issue.severity === 'error' ? '❌' : '⚠️';
            console.log(`${icon} [${issue.file}] ${issue.message}`);
        }
    }

    console.log(`\nResult: ${passed}/${CHECKS.length} file passano\n`);

    const hasErrors = allIssues.some((i) => i.severity === 'error');
    process.exit(hasErrors ? 1 : 0);
}

run();
