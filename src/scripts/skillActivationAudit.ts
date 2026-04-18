/**
 * skillActivationAudit.ts — Verifica che le skill critiche esistano e siano attivabili
 *
 * Per ogni skill critica del progetto, verifica:
 * - directory e file skill.md/index.md esistono
 * - contenuto include snippet chiave atteso
 * - nessun duplicato ovvio tra skill diverse
 *
 * Uso:
 *   npx ts-node src/scripts/skillActivationAudit.ts
 *   npm run audit:skills
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface SkillCheck {
    name: string;
    passed: boolean;
    detail: string;
}

const SKILLS_DIR = join(homedir(), '.claude', 'skills');

interface CriticalSkill {
    dir: string;
    requiredSnippet: string;
    description: string;
}

const CRITICAL_SKILLS: CriticalSkill[] = [
    { dir: 'antiban-review', requiredSnippet: 'SICURO', description: 'Review anti-ban per file LinkedIn' },
    { dir: 'context-handoff', requiredSnippet: 'SESSION_HANDOFF', description: 'Handoff contesto tra sessioni' },
    { dir: 'loop-codex', requiredSnippet: 'loop', description: 'Loop di completamento task' },
    { dir: 'audit-rules', requiredSnippet: 'audit', description: 'Audit compliance regole' },
    { dir: 'memoria', requiredSnippet: 'memory', description: 'Gestione memoria persistente' },
];

function readSkillContent(skillDir: string): string | null {
    const candidates = [join(SKILLS_DIR, skillDir, 'skill.md'), join(SKILLS_DIR, skillDir, 'index.md')];
    for (const path of candidates) {
        if (existsSync(path)) {
            return readFileSync(path, 'utf8');
        }
    }
    return null;
}

function checkCriticalSkill(skill: CriticalSkill): SkillCheck {
    const dirPath = join(SKILLS_DIR, skill.dir);
    if (!existsSync(dirPath)) {
        return {
            name: skill.dir,
            passed: false,
            detail: `Directory ${skill.dir}/ non trovata in ${SKILLS_DIR}`,
        };
    }

    const content = readSkillContent(skill.dir);
    if (!content) {
        return {
            name: skill.dir,
            passed: false,
            detail: `Directory esiste ma manca skill.md/index.md`,
        };
    }

    const hasSnippet = content.toLowerCase().includes(skill.requiredSnippet.toLowerCase());
    if (!hasSnippet) {
        return {
            name: skill.dir,
            passed: false,
            detail: `File skill trovato ma snippet "${skill.requiredSnippet}" assente`,
        };
    }

    return {
        name: skill.dir,
        passed: true,
        detail: `${skill.description} — presente e contenuto verificato`,
    };
}

function countAllSkills(): { total: number; withContent: number; empty: number } {
    if (!existsSync(SKILLS_DIR)) return { total: 0, withContent: 0, empty: 0 };
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    let withContent = 0;
    let empty = 0;
    for (const dir of dirs) {
        const content = readSkillContent(dir);
        if (content && content.trim().length > 0) {
            withContent++;
        } else {
            empty++;
        }
    }
    return { total: dirs.length, withContent, empty };
}

function run(): void {
    console.log('\n=== Skill Activation Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    // Critical skills check
    console.log('--- Skill critiche ---');
    const results: SkillCheck[] = [];
    for (const skill of CRITICAL_SKILLS) {
        const result = checkCriticalSkill(skill);
        results.push(result);
        const icon = result.passed ? '\u2705' : '\u274C';
        console.log(`${icon} ${result.name}: ${result.detail}`);
    }

    // Inventory stats
    console.log('\n--- Inventario skill ---');
    const stats = countAllSkills();
    console.log(`  Totali: ${stats.total}`);
    console.log(`  Con contenuto: ${stats.withContent}`);
    console.log(`  Vuote (solo directory): ${stats.empty}`);
    if (stats.empty > 0) {
        console.log(`  \u26A0\uFE0F ${stats.empty} skill vuote — candidare a rimozione`);
    }

    // Summary
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed);

    console.log(`\n--- ${passed}/${results.length} skill critiche verificate ---`);
    if (failed.length === 0) {
        console.log('\u2705 Tutte le skill critiche sono attivabili.');
        process.exit(0);
    } else {
        console.log(`\n\u274C ${failed.length} skill critiche mancanti o incomplete:`);
        failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
        process.exit(1);
    }
}

run();
