/**
 * skillActivationAudit.ts — Verifica che le skill critiche esistano e siano attivabili
 *
 * SCOPE (importante): questo e' un check di **presenza minima / loadability**, NON una
 * misura di copertura totale del catalogo skill. Verifica che le skill critiche per il
 * funzionamento del progetto siano installate e caricabili — non garantisce che TUTTE le
 * skill desiderabili siano presenti. Vedi `docs/tracking/AI_AUDIT_CADENCES.md`:
 * "skill critiche ancora attivabili (no manifest rotti dopo update marketplace)".
 *
 * Per ogni skill critica del progetto, verifica:
 * - directory e file skill.md/index.md esistono
 * - contenuto include snippet chiave atteso
 * - contenuto NON e' vuoto/troncato (corpo minimo): cattura il manifest rotto dopo un
 *   aggiornamento marketplace, scenario in cui lo snippet potrebbe sopravvivere ma il
 *   file resta inutilizzabile.
 *
 * Inventario dinamico (segnale informativo, NON pass/fail per le skill non-critiche per
 * evitare falsi-fail su rimozioni legittime): conta totale skill, con contenuto e vuote.
 * L'unico fail su inventario scatta se NESSUNA skill e' caricabile (directory wiped),
 * sintomo di control plane rotto — non drift legittimo.
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

/**
 * Soglia di corpo minimo per considerare un SKILL.md critico "caricabile".
 * Conservativa: un SKILL.md reale ha frontmatter + descrizione ben oltre 50 char,
 * quindi nessun falso-fail su skill legittime; serve solo a catturare file
 * troncati/svuotati (manifest rotto dopo update marketplace).
 */
const MIN_SKILL_BODY_CHARS = 50;

interface CriticalSkill {
    dir: string;
    requiredSnippet: string;
    description: string;
}

const CRITICAL_SKILLS: CriticalSkill[] = [
    { dir: 'antiban-review', requiredSnippet: 'SICURO', description: 'Review anti-ban per file LinkedIn' },
    { dir: 'context-handoff', requiredSnippet: 'CONTINUATION.md', description: 'Continuita contesto tra sessioni' },
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

    // Corpo minimo: cattura un manifest troncato/svuotato dopo update marketplace.
    // Floor conservativo (nessun SKILL.md critico reale e' sotto questa soglia) =>
    // zero rischio di falso-fail, ma fail reale se il file e' di fatto inutilizzabile.
    const body = content.trim();
    if (body.length < MIN_SKILL_BODY_CHARS) {
        return {
            name: skill.dir,
            passed: false,
            detail: `File skill caricato ma corpo minimo (${body.length} char < ${MIN_SKILL_BODY_CHARS}): manifest probabilmente troncato o svuotato`,
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

    // Floor di control plane: se NESSUNA skill e' caricabile, la directory e' wiped o
    // rotta. Questo NON e' drift legittimo (un control plane vivo ha sempre contenuto):
    // e' l'unica condizione di inventario che diventa fail, senza rischio falso-fail.
    const inventoryBroken = stats.withContent === 0;
    if (inventoryBroken) {
        console.log(`  [FAIL] Nessuna skill caricabile in ${SKILLS_DIR} — control plane skill assente o corrotto.`);
    }

    // Summary
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed);

    console.log(`\n--- ${passed}/${results.length} skill critiche verificate ---`);
    if (failed.length === 0 && !inventoryBroken) {
        console.log('\u2705 Tutte le skill critiche sono attivabili.');
        process.exit(0);
    } else {
        console.log(`\n\u274C ${failed.length} skill critiche mancanti o incomplete:`);
        failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
        process.exit(1);
    }
}

run();
