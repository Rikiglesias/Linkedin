/**
 * handoffStalenessAudit.ts — Verifica che SESSION_HANDOFF.md e .claude/SESSION_PROMPT.md
 * non siano stale rispetto allo stato corrente del repo.
 *
 * Controlli:
 * - data nell'header del handoff vs data corrente (warning > 14 giorni)
 * - commit citato nel session prompt vs HEAD corrente
 * - branch citato vs branch corrente
 * - working tree dirty non riflesso nei file
 *
 * Uso:
 *   npx ts-node src/scripts/handoffStalenessAudit.ts
 *   npm run audit:handoff-staleness
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

const REPO_ROOT = process.cwd();
const HANDOFF_PATH = join(REPO_ROOT, 'SESSION_HANDOFF.md');
const PROMPT_PATH = join(REPO_ROOT, '.claude', 'SESSION_PROMPT.md');
const STALE_DAYS_WARNING = 14;

function readFileSafe(path: string): string | null {
    try {
        return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
        return null;
    }
}

function gitCommand(args: string): string | null {
    try {
        return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

function extractDate(text: string): string | null {
    const match = text.match(/(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function extractShortCommit(text: string): string | null {
    const match = text.match(/(?:Ultimo commit|commit):\s*([a-f0-9]{7,40})/i);
    return match ? match[1].substring(0, 7) : null;
}

function extractBranch(text: string): string | null {
    const match = text.match(/Branch:\s*([^\s|]+)/i);
    return match ? match[1] : null;
}

function daysSince(dateStr: string): number {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return -1;
    const diffMs = Date.now() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function checkHandoffPresence(): CheckResult {
    if (!existsSync(HANDOFF_PATH)) {
        return { name: 'SESSION_HANDOFF.md presente', passed: false, detail: `File mancante: ${HANDOFF_PATH}` };
    }
    return { name: 'SESSION_HANDOFF.md presente', passed: true, detail: 'File trovato in root' };
}

function checkSessionPromptPresence(): CheckResult {
    if (!existsSync(PROMPT_PATH)) {
        return { name: '.claude/SESSION_PROMPT.md presente', passed: false, detail: `File mancante: ${PROMPT_PATH}` };
    }
    return { name: '.claude/SESSION_PROMPT.md presente', passed: true, detail: 'File trovato in .claude/' };
}

function checkHandoffDateFreshness(): CheckResult {
    const text = readFileSafe(HANDOFF_PATH);
    if (!text) {
        return { name: 'Handoff: data fresca', passed: false, detail: 'handoff non leggibile' };
    }
    const date = extractDate(text);
    if (!date) {
        return { name: 'Handoff: data fresca', passed: false, detail: 'nessuna data ISO trovata nell\'header' };
    }
    const days = daysSince(date);
    if (days < 0) {
        return { name: 'Handoff: data fresca', passed: false, detail: `data malformata: ${date}` };
    }
    if (days > STALE_DAYS_WARNING) {
        return { name: 'Handoff: data fresca', passed: false, detail: `handoff datato ${date} (${days} giorni fa) — aggiornare prima di nuova chat` };
    }
    return { name: 'Handoff: data fresca', passed: true, detail: `handoff del ${date} (${days} giorni fa)` };
}

function checkSessionPromptCommitMatch(): CheckResult {
    const text = readFileSafe(PROMPT_PATH);
    if (!text) {
        return { name: 'Session prompt: commit allineato', passed: false, detail: 'session prompt non leggibile' };
    }
    const citedCommit = extractShortCommit(text);
    if (!citedCommit) {
        return { name: 'Session prompt: commit allineato', passed: false, detail: 'nessun commit citato nel session prompt' };
    }
    const headCommit = gitCommand('rev-parse --short HEAD');
    if (!headCommit) {
        return { name: 'Session prompt: commit allineato', passed: false, detail: 'git non disponibile per verifica HEAD' };
    }
    const headShort = headCommit.substring(0, 7);
    if (citedCommit !== headShort) {
        const commitsAhead = gitCommand(`rev-list --count ${citedCommit}..HEAD`);
        const aheadInfo = commitsAhead ? ` (${commitsAhead} commit avanti)` : '';
        return {
            name: 'Session prompt: commit allineato',
            passed: false,
            detail: `prompt cita ${citedCommit}, HEAD ora e' ${headShort}${aheadInfo} — rigenerare con /session-prompt`,
        };
    }
    return { name: 'Session prompt: commit allineato', passed: true, detail: `prompt e HEAD su ${headShort}` };
}

function checkSessionPromptBranchMatch(): CheckResult {
    const text = readFileSafe(PROMPT_PATH);
    if (!text) {
        return { name: 'Session prompt: branch allineato', passed: false, detail: 'session prompt non leggibile' };
    }
    const citedBranch = extractBranch(text);
    if (!citedBranch) {
        return { name: 'Session prompt: branch allineato', passed: true, detail: 'nessun branch citato (ok)' };
    }
    const currentBranch = gitCommand('rev-parse --abbrev-ref HEAD');
    if (!currentBranch) {
        return { name: 'Session prompt: branch allineato', passed: false, detail: 'git non disponibile' };
    }
    if (citedBranch !== currentBranch) {
        return {
            name: 'Session prompt: branch allineato',
            passed: false,
            detail: `prompt cita branch '${citedBranch}', repo ora su '${currentBranch}'`,
        };
    }
    return { name: 'Session prompt: branch allineato', passed: true, detail: `entrambi su '${currentBranch}'` };
}

function checkWorkingTreeReflected(): CheckResult {
    const status = gitCommand('status --porcelain');
    if (status === null) {
        return { name: 'Working tree riflesso nel prompt', passed: false, detail: 'git non disponibile' };
    }
    const promptText = readFileSafe(PROMPT_PATH);
    if (!promptText) {
        return { name: 'Working tree riflesso nel prompt', passed: false, detail: 'session prompt non leggibile' };
    }
    const dirty = status.split('\n').filter((l) => l.trim().length > 0);
    if (dirty.length === 0) {
        return { name: 'Working tree riflesso nel prompt', passed: true, detail: 'working tree pulito' };
    }
    const modifiedFiles = dirty
        .map((l) => l.substring(3).trim())
        .filter((f) => !f.startsWith('"WhatsApp Image'));
    const unmentioned = modifiedFiles.filter((f) => !promptText.includes(f));
    if (unmentioned.length > 0 && modifiedFiles.length > 3) {
        return {
            name: 'Working tree riflesso nel prompt',
            passed: false,
            detail: `${modifiedFiles.length} file dirty, ${unmentioned.length} non menzionati nel prompt — rigenerare`,
        };
    }
    return {
        name: 'Working tree riflesso nel prompt',
        passed: true,
        detail: `${modifiedFiles.length} file dirty, copertura accettabile`,
    };
}

function run(): void {
    console.log('=== Handoff Staleness Audit ===\n');
    const today = new Date().toISOString().slice(0, 10);
    console.log(`Data: ${today}\n`);

    const checks: CheckResult[] = [
        checkHandoffPresence(),
        checkSessionPromptPresence(),
        checkHandoffDateFreshness(),
        checkSessionPromptCommitMatch(),
        checkSessionPromptBranchMatch(),
        checkWorkingTreeReflected(),
    ];

    let passed = 0;
    for (const check of checks) {
        const icon = check.passed ? '✅' : '❌';
        console.log(`${icon} ${check.name}`);
        console.log(`   → ${check.detail}`);
        if (check.passed) passed++;
    }

    console.log(`\n--- ${passed}/${checks.length} check passati ---`);

    if (passed < checks.length) {
        console.log('\nRigenera handoff/prompt con `/context-handoff` o `/session-prompt` prima di aprire una nuova chat.');
        process.exit(1);
    }

    console.log('\n✅ Handoff e session prompt sono freschi e allineati al repo.');
}

run();
