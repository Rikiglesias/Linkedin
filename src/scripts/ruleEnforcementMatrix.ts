/**
 * ruleEnforcementMatrix.ts — Matrice di enforcement delle regole critiche AI
 *
 * Per ogni regola critica del sistema AI, verifica:
 * - tipo di enforcement: hook-bloccante, hook-asincrono, runtime-brief, non-meccanizzabile
 * - se l'enforcement e' davvero in atto (verifica meccanica)
 * - gap identificati con proposta di chiusura
 *
 * Uso:
 *   npx ts-node src/scripts/ruleEnforcementMatrix.ts
 *   npm run audit:rule-enforcement
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

type Status = 'ENFORCED' | 'GAP' | 'NOT_MECH';
type EnforcementType = 'hook-bloccante' | 'hook-asincrono' | 'runtime-brief' | 'non-meccanizzabile';

interface RuleResult {
    id: string;
    name: string;
    category: string;
    type: EnforcementType;
    status: Status;
    detail: string;
    gapNote?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readText(filePath: string): string | null {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf8');
}

function readJson<T>(filePath: string): T | null {
    const text = readText(filePath);
    if (!text) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hookExists(settings: Record<string, unknown>, event: string, commandSnippet: string): boolean {
    const hooksMap = isRecord(settings['hooks']) ? settings['hooks'] : {};
    const entries = hooksMap[event];
    if (!Array.isArray(entries)) return false;
    return entries.some((entry: unknown) => {
        if (!isRecord(entry)) return false;
        const sub = entry['hooks'];
        if (!Array.isArray(sub)) return false;
        return sub.some(
            (h: unknown) => isRecord(h) && typeof h['command'] === 'string' && h['command'].includes(commandSnippet),
        );
    });
}

// ─── Check helpers ────────────────────────────────────────────────────────────

function hookRule(
    id: string,
    name: string,
    category: string,
    type: EnforcementType,
    present: boolean,
    detail: string,
    gapNote?: string,
): RuleResult {
    return { id, name, category, type, status: present ? 'ENFORCED' : 'GAP', detail, gapNote };
}

function briefRule(id: string, name: string, snippet: string, brief: string | null): RuleResult {
    const found = brief ? brief.includes(snippet) : false;
    return {
        id,
        name,
        category: 'Runtime brief',
        type: 'runtime-brief',
        status: found ? 'ENFORCED' : 'GAP',
        detail: found
            ? 'Presente in AI_RUNTIME_BRIEF.md — reiniettato via UserPromptSubmit + PreCompact'
            : `Snippet "${snippet}" assente dal runtime brief`,
        gapNote: found ? undefined : `Aggiungere "${snippet}" in docs/AI_RUNTIME_BRIEF.md`,
    };
}

function notMechRule(id: string, name: string, note: string): RuleResult {
    return {
        id,
        name,
        category: 'Non meccanizzabile',
        type: 'non-meccanizzabile',
        status: 'NOT_MECH',
        detail: note,
    };
}

// ─── Rule checks ──────────────────────────────────────────────────────────────

const HOME = homedir();
const SETTINGS_PATH = join(HOME, '.claude', 'settings.json');
const HOOKS_DIR = join(HOME, '.claude', 'hooks');
const BRIEF_PATH = resolve('docs', 'AI_RUNTIME_BRIEF.md');

function buildMatrix(): RuleResult[] {
    const settings = readJson<Record<string, unknown>>(SETTINGS_PATH) ?? {};
    const brief = readText(BRIEF_PATH);

    // --- A: Hook bloccante ---
    const antiBanScript = readText(join(HOOKS_DIR, 'pre-edit-antiban.ps1'));
    const antiBanOk =
        hookExists(settings, 'PreToolUse', 'pre-edit-antiban.ps1') &&
        (antiBanScript?.includes('Write-HookDecision') ?? false) &&
        (antiBanScript?.includes('deny') ?? false);

    const results: RuleResult[] = [
        hookRule(
            'antiban-pre-edit',
            'Anti-ban review prima di modifica file sensibili LinkedIn',
            'Hook bloccante',
            'hook-bloccante',
            antiBanOk,
            antiBanOk
                ? 'PreToolUse Edit/Write → pre-edit-antiban.ps1 con Write-HookDecision deny'
                : 'Hook presente ma senza permissionDecision deny, oppure hook mancante',
            antiBanOk ? undefined : 'Verificare pre-edit-antiban.ps1: deve usare Write-HookDecision -Decision deny',
        ),
        hookRule(
            'l1-gate-commit',
            'Quality gate L1 prima del commit git',
            'Hook bloccante',
            'hook-bloccante',
            hookExists(settings, 'PreToolUse', 'pre-bash-l1-gate.ps1'),
            'PreToolUse Bash → pre-bash-l1-gate.ps1',
            'Aggiungere pre-bash-l1-gate.ps1 in PreToolUse Bash',
        ),
        hookRule(
            'git-gate',
            'Git state validation prima del push',
            'Hook bloccante',
            'hook-bloccante',
            hookExists(settings, 'PreToolUse', 'pre-bash-git-gate.ps1'),
            'PreToolUse Bash → pre-bash-git-gate.ps1',
            'Aggiungere pre-bash-git-gate.ps1 in PreToolUse Bash',
        ),

        // --- B: Hook sync/asincrono ---
        hookRule(
            'session-start',
            'Caricamento memoria e runtime brief a inizio sessione',
            'Hook sync',
            'hook-asincrono',
            hookExists(settings, 'SessionStart', 'session-start.ps1'),
            'SessionStart → session-start.ps1',
            'Aggiungere session-start.ps1 in SessionStart',
        ),
        hookRule(
            'runtime-brief-prompt',
            'Runtime brief reiniettato a ogni prompt utente',
            'Hook asincrono',
            'hook-asincrono',
            hookExists(settings, 'UserPromptSubmit', 'inject-runtime-brief.ps1'),
            'UserPromptSubmit → inject-runtime-brief.ps1',
            'Aggiungere inject-runtime-brief.ps1 in UserPromptSubmit',
        ),
        hookRule(
            'runtime-brief-compact',
            'Runtime brief reiniettato prima del compact',
            'Hook asincrono',
            'hook-asincrono',
            hookExists(settings, 'PreCompact', 'inject-runtime-brief.ps1'),
            'PreCompact → inject-runtime-brief.ps1',
            'Aggiungere inject-runtime-brief.ps1 in PreCompact',
        ),
        hookRule(
            'quality-log',
            'Log comandi qualità (tsc, vitest, madge, npm run)',
            'Hook asincrono',
            'hook-asincrono',
            hookExists(settings, 'PostToolUse', 'post-bash-quality-log.ps1'),
            'PostToolUse Bash → post-bash-quality-log.ps1',
            'Aggiungere post-bash-quality-log.ps1 in PostToolUse Bash',
        ),
        hookRule(
            'git-audit-log',
            'Audit git automatico dopo operazioni git',
            'Hook asincrono',
            'hook-asincrono',
            hookExists(settings, 'PostToolUse', 'post-bash-git-audit.ps1'),
            'PostToolUse Bash → post-bash-git-audit.ps1',
            'Aggiungere post-bash-git-audit.ps1 in PostToolUse Bash',
        ),
        hookRule(
            'violations-tracker',
            'Violations tracker: miss antiban loggato automaticamente',
            'Hook asincrono',
            'hook-asincrono',
            hookExists(settings, 'PostToolUse', 'post-edit-antiban-audit.ps1'),
            'PostToolUse Edit/Write → post-edit-antiban-audit.ps1',
            'Aggiungere post-edit-antiban-audit.ps1 in PostToolUse Edit/Write',
        ),
        hookRule(
            'file-size-check',
            'Avviso file >300 righe per valutare split',
            'Hook asincrono',
            'hook-asincrono',
            hookExists(settings, 'PostToolUse', 'file-size-check.ps1'),
            'PostToolUse Edit/Write → file-size-check.ps1',
            'Aggiungere file-size-check.ps1 in PostToolUse Edit/Write',
        ),
        hookRule(
            'teammate-events',
            'Log eventi agent team (idle, created, completed)',
            'Hook asincrono',
            'hook-asincrono',
            hookExists(settings, 'TeammateIdle', 'teammate-event.ps1') &&
                hookExists(settings, 'TaskCreated', 'teammate-event.ps1') &&
                hookExists(settings, 'TaskCompleted', 'teammate-event.ps1'),
            'TeammateIdle/TaskCreated/TaskCompleted → teammate-event.ps1',
            'Aggiungere teammate-event.ps1 in TeammateIdle, TaskCreated e TaskCompleted',
        ),
        ((): RuleResult => {
            const stopScript = readText(join(HOOKS_DIR, 'stop-session.ps1'));
            const hasWorklogCheck = stopScript?.includes('ENGINEERING_WORKLOG') ?? false;
            return hookRule(
                'worklog-update',
                'Avviso aggiornamento ENGINEERING_WORKLOG a fine sessione',
                'Hook asincrono',
                'hook-asincrono',
                hasWorklogCheck,
                hasWorklogCheck
                    ? 'Stop → stop-session.ps1 controlla ENGINEERING_WORKLOG'
                    : "stop-session.ps1 non controlla se ENGINEERING_WORKLOG.md e' stato aggiornato",
                "Aggiungere in stop-session.ps1 un avviso se ENGINEERING_WORKLOG.md non e' in git diff HEAD",
            );
        })(),

        // --- C: Runtime brief ---
        briefRule('orchestrazione', 'Orchestrazione cognitiva contestuale', 'contestuale e automatico', brief),
        briefRule(
            'requirement-ledger',
            'Requirement ledger per prompt lunghi',
            'Requirement ledger obbligatorio',
            brief,
        ),
        briefRule(
            'anti-allucinazione',
            'Anti-allucinazione completa (no false completion)',
            'Nessuna allucinazione',
            brief,
        ),
        briefRule(
            'orizzonti-temporali',
            'Classificazione orizzonti temporali breve/medio/lungo',
            'orizzonte temporale dominante',
            brief,
        ),
        briefRule('degrado-contesto', 'Rilevazione degrado contesto e handoff', 'degrado del contesto', brief),
        briefRule('capability-gap', 'Riconoscimento capability gap e promozione', 'capability gap', brief),
        briefRule('esempi-non-chiusi', 'Esempi utente non trattati come lista chiusa', 'pattern da estendere', brief),
        briefRule(
            'blast-radius',
            'Blast radius: dipendenze dirette e indirette',
            'dipendenze, import, contratti',
            brief,
        ),
        briefRule(
            'fonte-verita',
            "Selezione fonte di verita' corretta per task",
            "Identificare la fonte di verita' corretta",
            brief,
        ),
        briefRule(
            'scelta-strumenti-esplicita',
            'Dichiarare fonte, strumenti attivati e strumenti esclusi nella risposta',
            'strumenti attivati e strumenti esclusi',
            brief,
        ),
        briefRule(
            'web-search-policy',
            'Regola decisionale web search: obbligatoria/facoltativa/inutile',
            'Ricerca web obbligatoria quando',
            brief,
        ),
        briefRule(
            'modello-ambiente-scelta',
            'Proporre modello e ambiente in base a qualita/costo/velocita/rischio',
            'Proporre modello e ambiente',
            brief,
        ),

        // --- D: Non meccanizzabile ---
        notMechRule(
            'ragionamento-visibile',
            'Spiegare ragionamento scelta strumenti in ogni risposta',
            'Richiede comprensione semantica del contenuto della risposta AI — non verificabile con script',
        ),
        notMechRule(
            'no-false-completion',
            'Non fingere completezza senza verifica reale del task',
            "Richiede comprensione semantica di cosa e' stato fatto e provato — non verificabile con script",
        ),
        notMechRule(
            'blast-radius-reale',
            'Analisi blast radius reale sulla codebase (caller, test, import)',
            'Richiede code search e ragionamento sulle dipendenze reali — si supporta con strumenti ma non si enforced automaticamente',
        ),
        notMechRule(
            'capability-governance',
            'Selezione e routing capability corretta per dominio (skill/MCP/plugin/hook/workflow)',
            'Richiede ragionamento contestuale sul dominio del task — non verificabile con script',
        ),
        notMechRule(
            'auto-commit-policy',
            'Commit automatico dopo verifiche verdi, push contestuale al tipo di lavoro',
            'Dipende dal contesto git e policy di branch — parzialmente enforced da git-gate hook ma non completamente',
        ),
    ];

    return results;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function run(): void {
    const results = buildMatrix();

    console.log('\n=== Rule Enforcement Matrix ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    const categories = [...new Set(results.map((r) => r.category))];
    for (const cat of categories) {
        console.log(`--- ${cat} ---`);
        const catResults = results.filter((r) => r.category === cat);
        for (const r of catResults) {
            const icon = r.status === 'ENFORCED' ? '✅' : r.status === 'GAP' ? '⚠️' : 'ℹ️';
            console.log(`${icon} [${r.id}] ${r.name}`);
            if (r.status !== 'ENFORCED') {
                console.log(`   → ${r.detail}`);
            }
        }
        console.log('');
    }

    const gaps = results.filter((r) => r.status === 'GAP');
    const enforced = results.filter((r) => r.status === 'ENFORCED');
    const notMech = results.filter((r) => r.status === 'NOT_MECH');

    console.log('--- Gap meccanizzabili da chiudere ---');
    if (gaps.length === 0) {
        console.log('Nessun gap rilevato ✅');
    } else {
        gaps.forEach((g, i) => {
            console.log(`${i + 1}. [${g.id}] ${g.name}`);
            if (g.gapNote) console.log(`   Azione: ${g.gapNote}`);
        });
    }

    console.log(`\n--- Riepilogo ---`);
    console.log(`Enforced:          ${enforced.length}/${results.length}`);
    console.log(`Gap meccanizzabili: ${gaps.length}`);
    console.log(`Non meccanizzabili: ${notMech.length} (by design)`);

    if (gaps.length > 0) {
        process.exit(1);
    }
    process.exit(0);
}

run();
