/**
 * handoffStalenessAudit.ts
 *
 * Audit legacy-compatible: il comando resta `audit:handoff-staleness`, ma la
 * fonte primaria di cambio chat ora e' `.claude/CONTINUATION.md` sincronizzato
 * in Obsidian `Resources/continuita/`.
 *
 * `SESSION_HANDOFF.md` e `.claude/SESSION_PROMPT.md` sono fallback legacy:
 * possono esistere, ma non sono piu' prerequisiti per aprire una nuova chat.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

const REPO_ROOT = process.cwd();
const CONTINUATION_PATH = join(REPO_ROOT, '.claude', 'CONTINUATION.md');
const LEGACY_HANDOFF_PATH = join(REPO_ROOT, 'SESSION_HANDOFF.md');
const LEGACY_PROMPT_PATH = join(REPO_ROOT, '.claude', 'SESSION_PROMPT.md');
const OBSIDIAN_VAULT = join(homedir(), 'Desktop', 'AI brain');
const OBSIDIAN_CONTINUITY_DIR = join(OBSIDIAN_VAULT, 'Resources', 'continuita');
const OBSIDIAN_CONTINUATION = join(OBSIDIAN_CONTINUITY_DIR, 'CONTINUATION-Linkedin.md');
const OBSIDIAN_START_NEXT_CHAT = join(OBSIDIAN_CONTINUITY_DIR, 'START-NEXT-CHAT.md');
const TODOS_SOURCE = join(homedir(), 'todos', 'active.md');
const TODOS_OBSIDIAN = join(OBSIDIAN_VAULT, 'Resources', 'sistema', 'active-todos.md');
const MEMORY_SOURCE = join(homedir(), 'memory', 'decisions_secondo_cervello.md');
const MEMORY_OBSIDIAN = join(OBSIDIAN_VAULT, 'Resources', 'memorie', 'decisions_secondo_cervello.md');
const MAX_SYNC_LAG_MS = 5 * 60 * 1000;

function readFileSafe(path: string): string | null {
    try {
        return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
        return null;
    }
}

function gitCommand(args: string[]): string | null {
    try {
        return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

function hasTodos(text: string): boolean {
    return /TODO:\s*\[AI:/i.test(text) || /^TODO:\s*$/im.test(text);
}

function hasStaleMarker(text: string): boolean {
    return /STALE-AFTER-COMMIT|CONTINUITY STALE|HANDOFF STALE/i.test(text);
}

function mtime(path: string): number | null {
    try {
        return existsSync(path) ? statSync(path).mtime.getTime() : null;
    } catch {
        return null;
    }
}

function checkContinuationPrimary(): CheckResult {
    const text = readFileSafe(CONTINUATION_PATH);
    if (!text) {
        return {
            name: 'Continuita primaria presente',
            passed: false,
            detail: `Manca ${CONTINUATION_PATH}. Gli hook devono generarlo prima di cambio chat/compact.`,
        };
    }

    const required = [
        'PROBLEMA CHE STAVAMO RISOLVENDO',
        'COSA E STATO COMPLETATO',
        'DECISIONI CHIAVE',
        'STATO TECNICO ESATTO',
        'PROSSIMO PASSO ESATTO',
    ];
    const missing = required.filter((snippet) => !text.includes(snippet));
    if (missing.length > 0) {
        return {
            name: 'Continuita primaria strutturata',
            passed: false,
            detail: `CONTINUATION.md manca sezioni: ${missing.join(', ')}`,
        };
    }

    if (hasTodos(text)) {
        return {
            name: 'Continuita primaria compilata',
            passed: false,
            detail: 'CONTINUATION.md contiene ancora placeholder TODO: [AI:]. Compilarlo prima di cambiare chat.',
        };
    }

    if (hasStaleMarker(text)) {
        return {
            name: 'Continuita primaria fresca',
            passed: false,
            detail: 'CONTINUATION.md e\' marcato stale dopo commit. Aggiornare memoria/continuation e risincronizzare Obsidian.',
        };
    }

    return {
        name: 'Continuita primaria pronta',
        passed: true,
        detail: '.claude/CONTINUATION.md presente, strutturato e senza placeholder.',
    };
}

function checkContinuationGitAlignment(): CheckResult {
    const text = readFileSafe(CONTINUATION_PATH);
    if (!text) {
        return { name: 'Continuita allineata al git', passed: false, detail: 'CONTINUATION.md non leggibile.' };
    }

    const headCommit = gitCommand(['rev-parse', '--short', 'HEAD']);
    const branch = gitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
    const status = gitCommand(['status', '--porcelain']);

    if (!headCommit || !branch || status === null) {
        return { name: 'Continuita allineata al git', passed: false, detail: 'git non disponibile per HEAD/branch/status.' };
    }

    const problems: string[] = [];
    if (!text.includes(headCommit)) {
        problems.push(`HEAD ${headCommit} non citato`);
    }
    if (!text.includes(`Branch: ${branch}`)) {
        problems.push(`branch ${branch} non citato`);
    }

    const dirtyFiles = status
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => line.substring(3).trim())
        .filter((file) => file && !file.startsWith('"WhatsApp Image'));

    const unmentionedDirty = dirtyFiles.filter((file) => !text.includes(file));
    if (unmentionedDirty.length > 0) {
        problems.push(`${unmentionedDirty.length}/${dirtyFiles.length} file dirty non riflessi: ${unmentionedDirty.slice(0, 5).join(', ')}`);
    }

    if (problems.length > 0) {
        return {
            name: 'Continuita allineata al git',
            passed: false,
            detail: `${problems.join('; ')}. Aggiornare CONTINUATION.md prima di nuova chat.`,
        };
    }

    return {
        name: 'Continuita allineata al git',
        passed: true,
        detail: `branch ${branch}, HEAD ${headCommit}, dirty files coperti: ${dirtyFiles.length}.`,
    };
}

function checkObsidianContinuityView(): CheckResult {
    const startText = readFileSafe(OBSIDIAN_START_NEXT_CHAT);
    const continuationText = readFileSafe(OBSIDIAN_CONTINUATION);
    if (!startText || !continuationText) {
        return {
            name: 'Obsidian: vista continuita presente',
            passed: false,
            detail: `Mancano ${OBSIDIAN_START_NEXT_CHAT} o ${OBSIDIAN_CONTINUATION}. Eseguire sync-memory-to-obsidian.mjs --verbose.`,
        };
    }

    const required = [
        'START NEXT CHAT - Continuita Obsidian',
        'SESSION_HANDOFF.md',
        'SESSION_PROMPT.md',
        'fallback legacy',
        'Resources/continuita/CONTINUATION-Linkedin.md',
    ];
    const missing = required.filter((snippet) => !startText.includes(snippet));
    if (missing.length > 0) {
        return {
            name: 'Obsidian: START-NEXT-CHAT corretto',
            passed: false,
            detail: `START-NEXT-CHAT.md manca: ${missing.join(', ')}`,
        };
    }

    if (hasTodos(continuationText) || hasStaleMarker(continuationText)) {
        return {
            name: 'Obsidian: CONTINUATION pubblicato valido',
            passed: false,
            detail: 'La copia Obsidian di CONTINUATION contiene TODO o marker stale.',
        };
    }

    return {
        name: 'Obsidian: vista continuita valida',
        passed: true,
        detail: 'Resources/continuita contiene START-NEXT-CHAT e CONTINUATION-Linkedin validi.',
    };
}

function checkFileFreshness(source: string, target: string, label: string): CheckResult {
    const sourceTime = mtime(source);
    const targetTime = mtime(target);
    if (sourceTime === null) {
        return { name: `${label}: fonte presente`, passed: false, detail: `Fonte mancante: ${source}` };
    }
    if (targetTime === null) {
        return { name: `${label}: sync Obsidian presente`, passed: false, detail: `Vista Obsidian mancante: ${target}` };
    }
    if (targetTime + MAX_SYNC_LAG_MS < sourceTime) {
        return {
            name: `${label}: sync fresco`,
            passed: false,
            detail: `Vista Obsidian piu' vecchia della fonte di ${Math.round((sourceTime - targetTime) / 1000)}s.`,
        };
    }
    return {
        name: `${label}: sync fresco`,
        passed: true,
        detail: 'Vista Obsidian allineata alla fonte.',
    };
}

function checkLegacyFilesAreFallbackOnly(): CheckResult {
    const present = [
        existsSync(LEGACY_HANDOFF_PATH) ? 'SESSION_HANDOFF.md' : null,
        existsSync(LEGACY_PROMPT_PATH) ? '.claude/SESSION_PROMPT.md' : null,
    ].filter(Boolean);

    return {
        name: 'Legacy handoff non obbligatorio',
        passed: true,
        detail:
            present.length > 0
                ? `${present.join(', ')} presenti ma trattati come fallback legacy.`
                : 'Nessun file legacy presente; ok, non sono prerequisiti.',
    };
}

function run(): void {
    console.log('=== Continuity / Handoff Staleness Audit ===\n');
    console.log(`Data: ${new Date().toISOString().slice(0, 10)}\n`);

    const checks: CheckResult[] = [
        checkContinuationPrimary(),
        checkContinuationGitAlignment(),
        checkObsidianContinuityView(),
        checkFileFreshness(TODOS_SOURCE, TODOS_OBSIDIAN, 'todos/active.md'),
        checkFileFreshness(MEMORY_SOURCE, MEMORY_OBSIDIAN, 'memoria secondo cervello'),
        checkLegacyFilesAreFallbackOnly(),
    ];

    let passed = 0;
    for (const check of checks) {
        const icon = check.passed ? 'OK' : 'FAIL';
        console.log(`[${icon}] ${check.name}`);
        console.log(`     ${check.detail}`);
        if (check.passed) passed++;
    }

    console.log(`\n--- ${passed}/${checks.length} check passati ---`);

    if (passed < checks.length) {
        console.log('\nAggiorna .claude/CONTINUATION.md, ~/memory, todos/active.md e riesegui sync Obsidian prima di aprire una nuova chat.');
        process.exit(1);
    }

    console.log('\nContinuita primaria e vista Obsidian fresche. SESSION_HANDOFF/SESSION_PROMPT restano solo fallback legacy.');
}

run();
