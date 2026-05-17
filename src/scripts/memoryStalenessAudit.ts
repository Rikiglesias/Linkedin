/**
 * memoryStalenessAudit.ts — Verifica staleness e coerenza della memoria persistente
 *
 * Controlla:
 * - memoria globale ~/memory/ e progetto ~/.claude/projects/.../memory/
 * - MEMORY.md index allineato ai file presenti
 * - file orfani (presenti ma non indicizzati) o riferimenti rotti (indicizzati ma file mancante)
 * - file stale (non aggiornati da > 30 giorni)
 * - frontmatter mancante (name/description/type)
 *
 * Item 13 backlog AI: memoria auto-mantenuta + indice sempre allineato.
 *
 * Uso:
 *   npm run audit:memory-staleness
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface MemoryDir {
    label: string;
    path: string;
    indexFile: string;
}

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

const STALE_DAYS_WARNING = 30;
const PROJECT_KEY = 'C--Users-albie-Desktop-Programmi-Linkedin';

// Tipi memory evergreen: contenuto stabile per natura (profilo utente, personalità,
// reference doc, rubrica contatti, preferenze). NON contati come stale.
const EVERGREEN_TYPES = new Set([
    'user',         // profilo utente stabile
    'personality',  // regole di ingaggio stabili
    'people',       // rubrica contatti
    'reference',    // best practice / playbook stabili
    'preferences',  // preferenze operative
    'computer',     // setup macchina
    'feedback',     // lezioni acquisite permanenti (correzioni utente)
]);

const DIRS: MemoryDir[] = [
    {
        label: 'global memory',
        path: join(homedir(), 'memory'),
        indexFile: 'MEMORY.md',
    },
    {
        label: 'project memory',
        path: join(homedir(), '.claude', 'projects', PROJECT_KEY, 'memory'),
        indexFile: 'MEMORY.md',
    },
];

function listMarkdownFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    try {
        return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
    } catch {
        return [];
    }
}

function readFileSafe(path: string): string | null {
    try {
        return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
        return null;
    }
}

function daysSinceModified(path: string): number {
    try {
        const mtime = statSync(path).mtimeMs;
        return Math.floor((Date.now() - mtime) / (1000 * 60 * 60 * 24));
    } catch {
        return -1;
    }
}

function extractIndexedFiles(indexContent: string): string[] {
    const linkRegex = /\(([a-zA-Z0-9_\-.]+\.md)\)/g;
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(indexContent)) !== null) {
        if (match[1] !== 'MEMORY.md') found.add(match[1]);
    }
    return Array.from(found);
}

function hasFrontmatter(content: string): boolean {
    return /^---\s*\n[\s\S]+?\n---/.test(content);
}

function extractFrontmatterFields(content: string): { name?: string; description?: string; type?: string } {
    const match = content.match(/^---\s*\n([\s\S]+?)\n---/);
    if (!match) return {};
    const fm = match[1];
    const name = fm.match(/name:\s*(.+)/)?.[1].trim();
    const description = fm.match(/description:\s*(.+)/)?.[1].trim();
    const typeLine = fm.match(/type:\s*(.+)/);
    const type = typeLine?.[1].trim();
    return { name, description, type };
}

function auditDir(dir: MemoryDir): CheckResult[] {
    const results: CheckResult[] = [];

    if (!existsSync(dir.path)) {
        return [
            {
                name: `[${dir.label}] directory esistente`,
                passed: false,
                detail: `dir mancante: ${dir.path}`,
            },
        ];
    }

    const files = listMarkdownFiles(dir.path);
    const indexPath = join(dir.path, dir.indexFile);
    const indexContent = readFileSafe(indexPath);

    if (!indexContent) {
        results.push({
            name: `[${dir.label}] MEMORY.md presente`,
            passed: false,
            detail: `MEMORY.md mancante o non leggibile: ${indexPath}`,
        });
        return results;
    }

    results.push({
        name: `[${dir.label}] MEMORY.md presente`,
        passed: true,
        detail: `${files.length} file .md + indice`,
    });

    const indexed = new Set(extractIndexedFiles(indexContent));
    const orphans = files.filter((f) => !indexed.has(f));
    const brokenRefs = Array.from(indexed).filter((f) => !files.includes(f));

    if (orphans.length > 0) {
        results.push({
            name: `[${dir.label}] file orfani`,
            passed: false,
            detail: `${orphans.length} file non indicizzati in MEMORY.md: ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? '...' : ''}`,
        });
    } else {
        results.push({
            name: `[${dir.label}] file orfani`,
            passed: true,
            detail: 'tutti i file sono indicizzati',
        });
    }

    if (brokenRefs.length > 0) {
        results.push({
            name: `[${dir.label}] riferimenti rotti`,
            passed: false,
            detail: `${brokenRefs.length} link in MEMORY.md verso file mancanti: ${brokenRefs.slice(0, 5).join(', ')}${brokenRefs.length > 5 ? '...' : ''}`,
        });
    } else {
        results.push({
            name: `[${dir.label}] riferimenti rotti`,
            passed: true,
            detail: 'tutti i link risolvono',
        });
    }

    const staleFiles: string[] = [];
    const noFrontmatter: string[] = [];
    const incompleteFrontmatter: string[] = [];

    for (const file of files) {
        const filePath = join(dir.path, file);
        const content = readFileSafe(filePath);
        if (!content) continue;

        const fields = hasFrontmatter(content) ? extractFrontmatterFields(content) : null;
        const memoryType = fields?.type?.trim().toLowerCase() ?? '';
        const isEvergreen = EVERGREEN_TYPES.has(memoryType);

        const days = daysSinceModified(filePath);
        if (days > STALE_DAYS_WARNING && !isEvergreen) {
            staleFiles.push(`${file} (${days}d)`);
        }

        if (!fields) {
            noFrontmatter.push(file);
        } else if (!fields.name || !fields.description || !fields.type) {
            incompleteFrontmatter.push(file);
        }
    }

    if (staleFiles.length > 0) {
        results.push({
            name: `[${dir.label}] memorie stale (>${STALE_DAYS_WARNING}d)`,
            passed: false,
            detail: `${staleFiles.length} file non aggiornati: ${staleFiles.slice(0, 5).join(', ')}${staleFiles.length > 5 ? '...' : ''}`,
        });
    } else {
        results.push({
            name: `[${dir.label}] memorie stale (>${STALE_DAYS_WARNING}d)`,
            passed: true,
            detail: 'nessuna memoria stale',
        });
    }

    if (noFrontmatter.length > 0) {
        results.push({
            name: `[${dir.label}] frontmatter mancante`,
            passed: false,
            detail: `${noFrontmatter.length} file senza frontmatter: ${noFrontmatter.slice(0, 5).join(', ')}${noFrontmatter.length > 5 ? '...' : ''}`,
        });
    } else {
        results.push({
            name: `[${dir.label}] frontmatter mancante`,
            passed: true,
            detail: 'tutti i file hanno frontmatter',
        });
    }

    if (incompleteFrontmatter.length > 0) {
        results.push({
            name: `[${dir.label}] frontmatter incompleto`,
            passed: false,
            detail: `${incompleteFrontmatter.length} file senza name/description/type: ${incompleteFrontmatter.slice(0, 5).join(', ')}${incompleteFrontmatter.length > 5 ? '...' : ''}`,
        });
    } else {
        results.push({
            name: `[${dir.label}] frontmatter incompleto`,
            passed: true,
            detail: 'frontmatter completo ovunque',
        });
    }

    return results;
}

function run(): void {
    console.log('=== Memory Staleness Audit ===\n');
    const today = new Date().toISOString().slice(0, 10);
    console.log(`Data: ${today}`);
    console.log(`Stale soglia: ${STALE_DAYS_WARNING} giorni\n`);

    const allResults: CheckResult[] = [];
    for (const dir of DIRS) {
        console.log(`--- ${dir.label} (${dir.path}) ---`);
        const results = auditDir(dir);
        for (const r of results) {
            const icon = r.passed ? '✅' : '⚠️';
            console.log(`${icon} ${r.name}`);
            console.log(`   → ${r.detail}`);
            allResults.push(r);
        }
        console.log('');
    }

    const passed = allResults.filter((r) => r.passed).length;
    console.log(`--- ${passed}/${allResults.length} check passati ---`);

    if (passed === allResults.length) {
        console.log('\n✅ Memoria coerente, indici allineati, niente stale.');
    } else {
        const warnings = allResults.length - passed;
        console.log(`\n⚠️ ${warnings} warning. Aggiornare memoria o indice MEMORY.md.`);
    }
}

run();
