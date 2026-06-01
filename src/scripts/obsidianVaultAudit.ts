/**
 * obsidianVaultAudit.ts - Verifica integrita' del vault "AI brain".
 *
 * Controlla link Obsidian, mojibake, base anonime e sync freshness
 * rispetto alle fonti autoritative in ~/memory e ~/.claude.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { basename, extname, join, relative } from 'path';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

const HOME = homedir();
const VAULT_DIR = join(HOME, 'Desktop', 'AI brain');
const MEMORY_DIR = join(HOME, 'memory');

const SYSTEM_FILES: Array<[string, string]> = [
    [join(HOME, '.claude', 'ZERO_RULES.md'), 'Resources/sistema/ZERO_RULES.md'],
    [join(HOME, '.claude', 'CLAUDE.md'), 'Resources/sistema/CLAUDE-globale.md'],
    [join(HOME, '.claude', 'CAPABILITY_INVENTORY.md'), 'Resources/sistema/CAPABILITY_INVENTORY.md'],
    [join(HOME, '.claude', 'L_LEVELS.md'), 'Resources/sistema/L_LEVELS.md'],
    [join(HOME, '.claude', 'CHECKLIST.md'), 'Resources/sistema/CHECKLIST.md'],
    [join(HOME, 'todos', 'active.md'), 'Resources/sistema/active-todos.md'],
    [
        join(HOME, 'Desktop', 'Programmi', 'Linkedin', 'docs', 'AI_MASTER_IMPLEMENTATION_BACKLOG.md'),
        'Resources/sistema/AI_MASTER_BACKLOG.md',
    ],
];

function readText(path: string): string {
    return readFileSync(path, 'utf8');
}

function walkFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.obsidian') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkFiles(path));
        else out.push(path);
    }
    return out;
}

function vaultRel(path: string): string {
    return relative(VAULT_DIR, path).replace(/\\/g, '/');
}

function lowerPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function checkVaultExists(): CheckResult {
    return {
        name: 'Vault presente',
        passed: existsSync(VAULT_DIR),
        detail: VAULT_DIR,
    };
}

function checkNoMojibake(mdFiles: string[]): CheckResult {
    const bad = mdFiles.filter((file) => readText(file).includes('\uFFFD')).map(vaultRel);
    return {
        name: 'Nessun mojibake U+FFFD',
        passed: bad.length === 0,
        detail: bad.length === 0 ? `${mdFiles.length} markdown puliti` : bad.join(', '),
    };
}

function checkBaseFiles(): CheckResult {
    const rootBase = readdirSync(VAULT_DIR).filter((name) => name.toLowerCase().endsWith('.base'));
    const anonymous = rootBase.filter((name) => /^senza nome.*\.base$/i.test(name));
    const required = ['bases/memorie.base', 'bases/decisioni.base'];
    const missing = required.filter((name) => !existsSync(join(VAULT_DIR, name)));
    const passed = anonymous.length === 0 && missing.length === 0;
    return {
        name: 'Bases nominate e presenti',
        passed,
        detail: passed
            ? 'memorie.base + decisioni.base presenti, nessuna base anonima in root'
            : [...anonymous.map((name) => `anonima:${name}`), ...missing.map((name) => `manca:${name}`)].join(', '),
    };
}

function buildFileIndexes(files: string[]): {
    byPath: Set<string>;
    byStem: Set<string>;
} {
    const byPath = new Set<string>();
    const byStem = new Set<string>();
    for (const file of files) {
        const rel = vaultRel(file);
        byPath.add(lowerPath(rel));
        byPath.add(lowerPath(rel.replace(/\.(md|base)$/i, '')));
        byStem.add(basename(rel, extname(rel)).toLowerCase());
    }
    return { byPath, byStem };
}

function resolveWikiTarget(target: string, indexes: { byPath: Set<string>; byStem: Set<string> }): boolean {
    const clean = target.split('|')[0].split('#')[0].trim();
    if (!clean) return true;

    const normalized = lowerPath(clean);
    const candidates = extname(normalized)
        ? [normalized]
        : [normalized, `${normalized}.md`, `${normalized}.base`];
    if (candidates.some((candidate) => indexes.byPath.has(candidate))) return true;
    return indexes.byStem.has(basename(normalized, extname(normalized)).toLowerCase());
}

function stripMarkdownCode(content: string): string {
    return content
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\r\n]+`/g, '');
}

function checkWikiLinks(mdFiles: string[], allFiles: string[]): CheckResult {
    const indexes = buildFileIndexes(allFiles);
    const missing: string[] = [];
    const wikiLink = /!?\[\[([^\]]+)\]\]/g;

    for (const file of mdFiles) {
        const rel = vaultRel(file);
        if (rel.startsWith('Resources/chat-log/')) continue;
        const content = stripMarkdownCode(readText(file));
        for (const match of content.matchAll(wikiLink)) {
            if (!resolveWikiTarget(match[1], indexes)) {
                missing.push(`${rel} -> [[${match[1]}]]`);
            }
        }
    }

    return {
        name: 'Wikilink risolvibili',
        passed: missing.length === 0,
        detail: missing.length === 0 ? 'nessun link rotto' : missing.slice(0, 20).join('; '),
    };
}

function checkSourceSync(): CheckResult {
    const mismatches: string[] = [];
    const memoryFiles = existsSync(MEMORY_DIR)
        ? readdirSync(MEMORY_DIR).filter((name) => name.endsWith('.md') && name !== 'MEMORY.md' && name !== 'CLAUDE.md')
        : [];

    for (const name of memoryFiles) {
        const src = join(MEMORY_DIR, name);
        const dest = join(VAULT_DIR, 'Resources', 'memorie', name);
        if (!existsSync(dest) || readText(src) !== readText(dest)) mismatches.push(`memorie/${name}`);
    }

    for (const [src, destRel] of SYSTEM_FILES) {
        const dest = join(VAULT_DIR, destRel);
        if (!existsSync(src)) continue;
        if (!existsSync(dest) || readText(src) !== readText(dest)) mismatches.push(destRel);
    }

    return {
        name: 'Sync freshness fonti autoritative',
        passed: mismatches.length === 0,
        detail: mismatches.length === 0 ? `${memoryFiles.length} memorie + ${SYSTEM_FILES.length} canonici allineati` : mismatches.join(', '),
    };
}

function run(): void {
    console.log('\n=== Obsidian Vault Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}`);
    console.log(`Vault: ${VAULT_DIR}\n`);

    const files = walkFiles(VAULT_DIR);
    const mdFiles = files.filter((file) => file.toLowerCase().endsWith('.md'));
    const linkableFiles = files.filter((file) => /\.(md|base)$/i.test(file));
    const checks = [
        checkVaultExists(),
        checkNoMojibake(mdFiles),
        checkBaseFiles(),
        checkWikiLinks(mdFiles, linkableFiles),
        checkSourceSync(),
    ];

    let passed = 0;
    for (const check of checks) {
        if (check.passed) passed += 1;
        console.log(`${check.passed ? 'OK' : 'FAIL'} ${check.name}`);
        console.log(`   -> ${check.detail}`);
    }

    console.log(`\n--- ${passed}/${checks.length} check passati ---`);
    if (passed !== checks.length) process.exit(1);
}

run();
