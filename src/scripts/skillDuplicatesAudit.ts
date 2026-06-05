/**
 * skillDuplicatesAudit.ts — Conta le skill installate e segnala SOLO coppie a nome esatto
 *
 * Scansiona ~/.claude/skills/ e produce un report PURAMENTE INFORMATIVO:
 *   - totale skill con contenuto
 *   - skill senza description chiara
 *   - coppie "twin" a stem esatto (es. X-generator / X-validator) = unico segnale reale
 *     di possibile consolidamento.
 *
 * NON raggruppa più per substring di dominio: quel raggruppamento era fuorviante
 * (es. 'architecture-designer' e 'audit' finivano in [marketing] perché la description
 * conteneva la sottostringa 'ad'/'audit'). Gli accoppiamenti per parole-nome generiche
 * (es. read-only-gh-pr-review <-> read-only-postgres) producevano falsi positivi e non
 * guidavano alcun consolidamento. Tenuto solo ciò che è segnale vero.
 *
 * Item 3 del backlog AI: governance capability — eliminare duplicati.
 *
 * Uso:
 *   npm run audit:skill-duplicates
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface SkillInfo {
    name: string;
    folder: string;
    description: string;
    fileSize: number;
}

/**
 * Coppia twin a stem esatto: stesso prefisso, suffixo di ruolo complementare.
 * Es. { stem: 'terraform', a: 'terraform-generator', b: 'terraform-validator' }
 */
interface TwinPair {
    stem: string;
    a: string;
    b: string;
    role: string;
}

const SKILLS_DIR = join(homedir(), '.claude', 'skills');

/**
 * Suffissi di ruolo complementari che, a parità di stem, indicano skill gemelle
 * (stesso dominio, fase diversa) → candidate reali a consolidamento o coabitazione.
 */
const TWIN_ROLE_SUFFIXES = ['generator', 'validator'];

/**
 * Anti path-traversal: accetta solo nomi di cartella "semplici" (no separatori,
 * no `..`, no path assoluti). Le voci provengono da readdirSync su una directory
 * fissa, ma la validazione esplicita chiude il rischio CWE-22 alla radice.
 */
function isSafeSkillName(name: string): boolean {
    return name.length > 0 && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

function readSkillFile(folder: string): string | null {
    if (!isSafeSkillName(folder)) return null;
    const skillPath = join(SKILLS_DIR, folder);
    if (!existsSync(skillPath) || !statSync(skillPath).isDirectory()) return null;
    for (const fileName of ['SKILL.md', 'index.md']) {
        const filePath = join(skillPath, fileName);
        if (existsSync(filePath)) {
            try {
                return readFileSync(filePath, 'utf8');
            } catch {
                return null;
            }
        }
    }
    return null;
}

function extractDescription(content: string): string {
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]+?)\n---/);
    if (!frontmatterMatch) {
        const firstLine = content.split('\n').find((l) => l.trim().length > 0);
        return (firstLine || '').slice(0, 200);
    }
    const fm = frontmatterMatch[1];
    const descMatch = fm.match(/description:\s*([\s\S]+?)(?:\n[a-z_]+:|\n---|$)/i);
    if (descMatch) {
        return descMatch[1].replace(/\s+/g, ' ').trim().slice(0, 400);
    }
    return '';
}

function loadSkills(): SkillInfo[] {
    if (!existsSync(SKILLS_DIR)) return [];
    const folders = readdirSync(SKILLS_DIR).filter((f) => statSync(join(SKILLS_DIR, f)).isDirectory());
    const skills: SkillInfo[] = [];
    for (const folder of folders) {
        const content = readSkillFile(folder);
        if (!content) continue;
        skills.push({
            name: folder,
            folder,
            description: extractDescription(content),
            fileSize: content.length,
        });
    }
    return skills;
}

/**
 * Decompone un nome skill in { stem, role } se termina con un suffisso di ruolo gemello.
 * Es. 'azure-pipelines-generator' → { stem: 'azure-pipelines', role: 'generator' }.
 * Restituisce null se il nome non termina con un suffisso noto.
 */
function splitStemRole(name: string): { stem: string; role: string } | null {
    const lower = name.toLowerCase();
    for (const role of TWIN_ROLE_SUFFIXES) {
        const suffix = `-${role}`;
        if (lower.endsWith(suffix)) {
            return { stem: lower.slice(0, -suffix.length), role };
        }
    }
    return null;
}

/**
 * Trova le coppie twin a stem esatto: stesso stem, ruoli complementari
 * (generator/validator). Unico segnale di duplicazione affidabile dai nomi.
 * Niente substring, niente "parole comuni" generiche → niente falsi positivi.
 */
function findTwinPairs(skills: SkillInfo[]): TwinPair[] {
    const byStem = new Map<string, Array<{ name: string; role: string }>>();
    for (const skill of skills) {
        const split = splitStemRole(skill.name);
        if (!split) continue;
        const list = byStem.get(split.stem) ?? [];
        list.push({ name: skill.name, role: split.role });
        byStem.set(split.stem, list);
    }

    const pairs: TwinPair[] = [];
    for (const [stem, members] of byStem) {
        if (members.length < 2) continue;
        // genera coppie distinte con ruoli diversi (es. generator + validator)
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                if (members[i].role === members[j].role) continue;
                const sorted = [members[i], members[j]].sort((x, y) => x.name.localeCompare(y.name));
                pairs.push({
                    stem,
                    a: sorted[0].name,
                    b: sorted[1].name,
                    role: `${sorted[0].role}/${sorted[1].role}`,
                });
            }
        }
    }
    return pairs.sort((a, b) => a.stem.localeCompare(b.stem));
}

function run(): void {
    console.log('=== Skill Duplicates Audit (informativo) ===\n');
    const today = new Date().toISOString().slice(0, 10);
    console.log(`Data: ${today}`);
    console.log(`Skills directory: ${SKILLS_DIR}\n`);

    const skills = loadSkills();
    console.log(`Skill totali con contenuto: ${skills.length}`);

    const noDescription = skills.filter((s) => s.description.length < 10);
    if (noDescription.length > 0) {
        console.log(`Skill senza description chiara: ${noDescription.length} (${noDescription.map((s) => s.name).slice(0, 10).join(', ')}${noDescription.length > 10 ? '...' : ''})`);
    }

    console.log('\n--- Coppie twin a nome esatto (stesso stem, ruoli complementari) ---');
    const twins = findTwinPairs(skills);
    if (twins.length === 0) {
        console.log('Nessuna coppia twin rilevata.');
    } else {
        console.log('Queste coppie condividono lo stesso stem: verificare se sono fasi complementari');
        console.log('dello stesso tool (legittime) o duplicati da fondere.');
        for (const t of twins) {
            console.log(`  ${t.a}  <->  ${t.b}  (stem: ${t.stem}, ${t.role})`);
        }
    }

    console.log('\n--- Sintesi ---');
    console.log(`Skill totali: ${skills.length}`);
    console.log(`Senza description chiara: ${noDescription.length}`);
    console.log(`Coppie twin a nome esatto: ${twins.length}`);
    console.log('\nOK — audit puramente informativo (conteggio + twin esatti), non blocca chiusura.');
}

run();
