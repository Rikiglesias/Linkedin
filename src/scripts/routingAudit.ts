/**
 * routingAudit.ts — valida `docs/tracking/AI_CAPABILITY_ROUTING.json`.
 *
 * Registro machine-readable del routing capability/domini. Chiude il gap
 * "routing-registry" della ruleEnforcementMatrix (G3, 2026-06-09): il file
 * esisteva ma mancava l'audit che lo verifica. Exit 0 se valido, 1 altrimenti
 * (per CI / git gate — vedi `.claude/rules/scripts-audit.md` #6).
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const REGISTRY = resolve('docs', 'tracking', 'AI_CAPABILITY_ROUTING.json');
const VALID_STATUS = new Set(['active', 'deprecated', 'planned', 'archived']);
const REQUIRED = ['id', 'kind', 'label', 'status', 'environments'] as const;

function fail(msg: string): never {
    console.error(`❌ [audit:routing] ${msg}`);
    process.exit(1);
}

if (!existsSync(REGISTRY)) {
    fail(`Registry mancante: ${REGISTRY}`);
}

let data: unknown;
try {
    data = JSON.parse(readFileSync(REGISTRY, 'utf8'));
} catch (err) {
    fail(`JSON non parsabile: ${err instanceof Error ? err.message : String(err)}`);
}

const caps = (data as { capabilities?: unknown }).capabilities;
if (!Array.isArray(caps) || caps.length === 0) {
    fail('Campo "capabilities" assente o vuoto.');
}

const ids = new Set<string>();
const errors: string[] = [];
caps.forEach((cap, i) => {
    if (typeof cap !== 'object' || cap === null) {
        errors.push(`capability[${i}] non e' un oggetto`);
        return;
    }
    const c = cap as Record<string, unknown>;
    for (const field of REQUIRED) {
        if (!(field in c) || c[field] === '' || c[field] === null || c[field] === undefined) {
            errors.push(`capability[${i}] (${String(c.id ?? '?')}) manca il campo "${field}"`);
        }
    }
    if (typeof c.id === 'string') {
        if (ids.has(c.id)) errors.push(`id duplicato: "${c.id}"`);
        ids.add(c.id);
    }
    if (typeof c.status === 'string' && !VALID_STATUS.has(c.status)) {
        errors.push(`capability "${String(c.id)}" status non valido: "${c.status}"`);
    }
    if (!Array.isArray(c.environments) || c.environments.length === 0) {
        errors.push(`capability "${String(c.id)}" environments deve essere un array non vuoto`);
    }
});

if (errors.length > 0) {
    console.error('❌ [audit:routing] Registry NON valido:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
}

console.log(
    `✅ [audit:routing] AI_CAPABILITY_ROUTING.json valido: ${caps.length} capability, ${ids.size} id univoci.`,
);
process.exit(0);
