/**
 * skillDuplicatesAudit.ts — Identifica overlap e duplicati tra skill installate
 *
 * Scansiona ~/.claude/skills/ e raggruppa per dominio + keyword
 * per identificare candidate da fondere, rimuovere o disambiguare.
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
    keywords: string[];
}

interface OverlapGroup {
    domain: string;
    skills: string[];
}

const SKILLS_DIR = join(homedir(), '.claude', 'skills');

const DOMAIN_KEYWORDS: Record<string, string[]> = {
    'web-frontend': ['react', 'vue', 'angular', 'nextjs', 'frontend', 'ui', 'css', 'tailwind', 'shadcn'],
    'web-backend': ['nestjs', 'fastapi', 'express', 'django', 'laravel', 'rails', 'api', 'rest', 'graphql'],
    'devops-cicd': ['github actions', 'gitlab', 'jenkins', 'azure pipelines', 'pipeline', 'ci/cd', 'workflow'],
    'devops-iac': ['terraform', 'ansible', 'helm', 'kubernetes', 'k8s', 'dockerfile', 'docker'],
    'language-spec': ['typescript', 'javascript', 'python', 'rust', 'golang', 'cpp', 'c#', 'csharp', 'java', 'kotlin', 'php', 'swift'],
    'security': ['security', 'vulnerability', 'secrets', 'auth', 'sast', 'owasp'],
    'review-test': ['review', 'test', 'tdd', 'audit', 'lint', 'quality'],
    'marketing': ['marketing', 'seo', 'ad', 'email', 'cold-email', 'copywriting', 'cro', 'landing', 'campaign'],
    'data-ml': ['ml', 'pipeline', 'evaluation', 'rag', 'embedding', 'fine-tuning', 'llm'],
    'docs-content': ['documenter', 'documentation', 'content', 'markdown', 'doc'],
    'cli-tools': ['cli', 'terminal', 'shell', 'bash', 'powershell'],
    'context-mgmt': ['context', 'memory', 'handoff', 'session', 'compression'],
    'design': ['design', 'banner', 'slide', 'brand', 'ui-ux', 'frontend-design'],
    'agent-ops': ['agent', 'multi-agent', 'subagent', 'mcp', 'skill'],
};

function readSkillFile(folder: string): string | null {
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

function extractKeywords(text: string): string[] {
    const lower = text.toLowerCase();
    const found = new Set<string>();
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
        for (const kw of keywords) {
            if (lower.includes(kw)) {
                found.add(domain);
                break;
            }
        }
    }
    return Array.from(found);
}

function loadSkills(): SkillInfo[] {
    if (!existsSync(SKILLS_DIR)) return [];
    const folders = readdirSync(SKILLS_DIR).filter((f) => statSync(join(SKILLS_DIR, f)).isDirectory());
    const skills: SkillInfo[] = [];
    for (const folder of folders) {
        const content = readSkillFile(folder);
        if (!content) continue;
        const description = extractDescription(content);
        skills.push({
            name: folder,
            folder,
            description,
            fileSize: content.length,
            keywords: extractKeywords(folder + ' ' + description),
        });
    }
    return skills;
}

function findNameOverlaps(skills: SkillInfo[]): Array<{ a: string; b: string; reason: string }> {
    const overlaps: Array<{ a: string; b: string; reason: string }> = [];
    for (let i = 0; i < skills.length; i++) {
        for (let j = i + 1; j < skills.length; j++) {
            const a = skills[i];
            const b = skills[j];
            const aLower = a.name.toLowerCase();
            const bLower = b.name.toLowerCase();
            if (aLower === bLower) {
                overlaps.push({ a: a.name, b: b.name, reason: 'nome identico' });
                continue;
            }
            if (aLower.includes(bLower) || bLower.includes(aLower)) {
                overlaps.push({ a: a.name, b: b.name, reason: 'nome contenuto' });
                continue;
            }
            const aWords = new Set(aLower.split(/[-_:]/));
            const bWords = new Set(bLower.split(/[-_:]/));
            const intersection = Array.from(aWords).filter((w) => bWords.has(w) && w.length > 3);
            if (intersection.length >= 2) {
                overlaps.push({ a: a.name, b: b.name, reason: `parole comuni: ${intersection.join(', ')}` });
            }
        }
    }
    return overlaps;
}

function groupByDomain(skills: SkillInfo[]): OverlapGroup[] {
    const map = new Map<string, string[]>();
    for (const skill of skills) {
        for (const domain of skill.keywords) {
            const list = map.get(domain) ?? [];
            list.push(skill.name);
            map.set(domain, list);
        }
    }
    return Array.from(map.entries())
        .map(([domain, list]) => ({ domain, skills: list.sort() }))
        .sort((a, b) => b.skills.length - a.skills.length);
}

function run(): void {
    console.log('=== Skill Duplicates Audit ===\n');
    const today = new Date().toISOString().slice(0, 10);
    console.log(`Data: ${today}`);
    console.log(`Skills directory: ${SKILLS_DIR}\n`);

    const skills = loadSkills();
    console.log(`Skill totali con contenuto: ${skills.length}`);

    const noDescription = skills.filter((s) => s.description.length < 10);
    if (noDescription.length > 0) {
        console.log(`Skill senza description chiara: ${noDescription.length}`);
    }

    console.log('\n--- Raggruppamento per dominio ---');
    const groups = groupByDomain(skills);
    for (const g of groups) {
        console.log(`[${g.domain}] ${g.skills.length} skill: ${g.skills.slice(0, 6).join(', ')}${g.skills.length > 6 ? '...' : ''}`);
    }

    const unclassified = skills.filter((s) => s.keywords.length === 0);
    if (unclassified.length > 0) {
        console.log(`\n[non classificate] ${unclassified.length}: ${unclassified.map((s) => s.name).slice(0, 10).join(', ')}${unclassified.length > 10 ? '...' : ''}`);
    }

    console.log('\n--- Overlap forti (parole nome in comune) ---');
    const overlaps = findNameOverlaps(skills);
    if (overlaps.length === 0) {
        console.log('Nessun overlap forte rilevato.');
    } else {
        for (const o of overlaps.slice(0, 30)) {
            console.log(`  ${o.a}  <->  ${o.b}  (${o.reason})`);
        }
        if (overlaps.length > 30) console.log(`  ... + ${overlaps.length - 30} altri`);
    }

    console.log('\n--- Domini con piu di 6 skill (candidate per consolidamento) ---');
    const oversized = groups.filter((g) => g.skills.length > 6);
    for (const g of oversized) {
        console.log(`  [${g.domain}] ${g.skills.length} skill — valutare se overlap reale o specializzazione legittima`);
    }

    console.log('\n--- Sintesi ---');
    console.log(`Skills totali: ${skills.length}`);
    console.log(`Overlap nome: ${overlaps.length}`);
    console.log(`Domini coperti: ${groups.length}`);
    console.log(`Domini oversize (>6 skill): ${oversized.length}`);
    console.log(`Non classificate: ${unclassified.length}`);
    console.log('\nOK — audit informativo, non blocca chiusura. Review manuale necessaria per consolidamenti.');
}

run();
