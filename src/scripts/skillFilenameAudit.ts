/**
 * skillFilenameAudit.ts — Audit canonical naming SKILL.md per le skill Claude Code
 *
 * Verifica che ogni cartella skill in ~/.claude/skills/ (o $SKILLS_DIR) contenga
 * il file canonico SKILL.md (uppercase). Variazioni non canoniche come
 * `skill.md`, `index.md`, `INDEX.md`, `Skill.md` vengono segnalate.
 *
 * Uso:
 *   npx ts-node src/scripts/skillFilenameAudit.ts
 *   npm run audit:skill-filenames
 *
 * Env vars:
 *   SKILLS_DIR — override path (default: ~/.claude/skills)
 *
 * Exit code 0 se tutte le skill hanno SKILL.md canonico, 1 se almeno una non conforme.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface SkillEntry {
    name: string;
    dir: string;
    hasCanonicalSkill: boolean;
    nonCanonicalFiles: string[];
}

const SKILLS_DIR =
    process.env.SKILLS_DIR ?? path.join(os.homedir(), '.claude', 'skills');

const NON_CANONICAL_NAMES = new Set(['skill.md', 'index.md', 'Skill.md', 'INDEX.md']);

function scanSkills(rootDir: string): SkillEntry[] {
    if (!fs.existsSync(rootDir)) {
        return [];
    }
    const entries: SkillEntry[] = [];
    for (const name of fs.readdirSync(rootDir)) {
        const dir = path.join(rootDir, name);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(dir);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) continue;

        const files = fs.readdirSync(dir);
        const hasSkillMd = files.includes('SKILL.md');
        const hasAnyMd = files.some((f) => f.endsWith('.md'));
        if (!hasAnyMd) continue;

        const nonCanonical = files.filter(
            (f) => NON_CANONICAL_NAMES.has(f) && f !== 'SKILL.md',
        );

        entries.push({
            name,
            dir,
            hasCanonicalSkill: hasSkillMd,
            nonCanonicalFiles: nonCanonical,
        });
    }
    return entries;
}

function run(): void {
    console.log('\n=== Skill Filename Audit ===');
    console.log(`Skills dir: ${SKILLS_DIR}`);
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    if (!fs.existsSync(SKILLS_DIR)) {
        console.log(`⚠️  Directory non esiste: ${SKILLS_DIR}`);
        console.log('Skip audit (env-specific).');
        process.exit(0);
    }

    const skills = scanSkills(SKILLS_DIR);
    const nonConforming = skills.filter(
        (s) => !s.hasCanonicalSkill || s.nonCanonicalFiles.length > 0,
    );

    const totalSkills = skills.length;
    const conforming = totalSkills - nonConforming.length;

    if (nonConforming.length === 0) {
        console.log(`✅ ${conforming}/${totalSkills} skill conformi (SKILL.md canonico)`);
        process.exit(0);
    }

    console.log(`❌ ${nonConforming.length} skill non conformi su ${totalSkills}\n`);
    for (const s of nonConforming) {
        const reasons: string[] = [];
        if (!s.hasCanonicalSkill) reasons.push('manca SKILL.md');
        if (s.nonCanonicalFiles.length > 0) {
            reasons.push(`file non canonici: ${s.nonCanonicalFiles.join(', ')}`);
        }
        console.log(`❌ ${s.name} — ${reasons.join(' | ')}`);
    }

    console.log(`\nResult: ${conforming}/${totalSkills} conformi\n`);
    process.exit(1);
}

run();
