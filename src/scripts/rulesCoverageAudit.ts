/**
 * rulesCoverageAudit.ts — Audit delle path-scoped rules in .claude/rules/
 *
 * Verifica per ogni file .md (eccetto README.md):
 *  1. YAML frontmatter parsabile con campi richiesti (name, paths, enforcement)
 *  2. ogni glob in `paths:` matcha almeno un file esistente nel repo
 *  3. il file e' elencato in .claude-plugin/plugin.json (contents.rules.files)
 *  4. README.md della cartella rules ha riga corrispondente nella tabella
 *
 * Uso:
 *   npx ts-node src/scripts/rulesCoverageAudit.ts
 *   npm run audit:rules-coverage
 *
 * Exit code 0 se tutto valido, 1 se almeno un check fallisce.
 */

import * as fs from 'fs';
import * as path from 'path';

interface RuleFrontmatter {
    name?: string;
    paths?: string[];
    enforcement?: string[];
}

interface RuleAudit {
    file: string;
    frontmatter: RuleFrontmatter | null;
    errors: string[];
    warnings: string[];
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RULES_DIR = path.join(REPO_ROOT, '.claude', 'rules');
const PLUGIN_JSON = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const RULES_README = path.join(RULES_DIR, 'README.md');

function parseFrontmatter(content: string): { fm: RuleFrontmatter | null; error?: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
        return { fm: null, error: 'frontmatter YAML non trovato (---...---)' };
    }
    const body = match[1];
    const fm: RuleFrontmatter = {};
    const lines = body.split(/\r?\n/);
    let currentKey: 'paths' | 'enforcement' | null = null;
    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, '');
        if (!line.trim()) {
            currentKey = null;
            continue;
        }
        const keyMatch = line.match(/^(\w+):\s*(.*)$/);
        const listItemMatch = line.match(/^\s+-\s+(.+)$/);
        if (keyMatch) {
            const [, key, val] = keyMatch;
            if (key === 'name') {
                fm.name = val.replace(/^["']|["']$/g, '');
                currentKey = null;
            } else if (key === 'paths') {
                fm.paths = val
                    ? [val.replace(/^["']|["']$/g, '')]
                    : [];
                currentKey = 'paths';
            } else if (key === 'enforcement') {
                fm.enforcement = val ? [val] : [];
                currentKey = 'enforcement';
            } else {
                currentKey = null;
            }
        } else if (listItemMatch && currentKey) {
            const item = listItemMatch[1].replace(/^["']|["']$/g, '');
            if (currentKey === 'paths') {
                if (!fm.paths) fm.paths = [];
                fm.paths.push(item);
            } else if (currentKey === 'enforcement') {
                if (!fm.enforcement) fm.enforcement = [];
                fm.enforcement.push(item);
            }
        }
    }
    return { fm };
}

function globMatchesAnyFile(globPattern: string): boolean {
    if (globPattern === '**') return true;
    const cleanGlob = globPattern.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = cleanGlob.split('/');
    const firstStarIdx = segments.findIndex((s) => s.includes('*'));
    let baseDir = REPO_ROOT;
    if (firstStarIdx > 0) {
        baseDir = path.join(REPO_ROOT, ...segments.slice(0, firstStarIdx));
    } else if (firstStarIdx === -1) {
        return fs.existsSync(path.join(REPO_ROOT, cleanGlob));
    }
    if (!fs.existsSync(baseDir)) return false;
    const stat = fs.statSync(baseDir);
    if (!stat.isDirectory()) return false;
    return fs.readdirSync(baseDir).length > 0;
}

function loadPluginJsonRulesFiles(): { files: string[]; error?: string } {
    try {
        const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
        const parsed = JSON.parse(raw);
        const files = parsed?.contents?.rules?.files;
        if (!Array.isArray(files)) {
            return { files: [], error: 'plugin.json contents.rules.files non e\' array' };
        }
        return { files };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { files: [], error: `plugin.json read error: ${msg}` };
    }
}

function loadReadmeRuleNames(): string[] {
    if (!fs.existsSync(RULES_README)) return [];
    const content = fs.readFileSync(RULES_README, 'utf8');
    const matches = content.matchAll(/\|\s*`([\w-]+\.md)`\s*\|/g);
    return Array.from(matches, (m) => m[1]);
}

function run(): void {
    console.log('\n=== Path-scoped Rules Coverage Audit ===');
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    if (!fs.existsSync(RULES_DIR)) {
        console.log(`❌ Cartella rules non esiste: ${RULES_DIR}`);
        process.exit(1);
    }

    const ruleFiles = fs
        .readdirSync(RULES_DIR)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .sort();

    if (ruleFiles.length === 0) {
        console.log('❌ Nessun file rule trovato');
        process.exit(1);
    }

    const { files: pluginRulesFiles, error: pluginErr } = loadPluginJsonRulesFiles();
    if (pluginErr) {
        console.log(`⚠️  ${pluginErr}`);
    }
    const readmeRuleNames = loadReadmeRuleNames();

    const audits: RuleAudit[] = [];
    let totalErrors = 0;

    for (const file of ruleFiles) {
        const abs = path.join(RULES_DIR, file);
        const content = fs.readFileSync(abs, 'utf8');
        const audit: RuleAudit = { file, frontmatter: null, errors: [], warnings: [] };

        const { fm, error: fmErr } = parseFrontmatter(content);
        if (fmErr || !fm) {
            audit.errors.push(fmErr || 'frontmatter null');
            audits.push(audit);
            continue;
        }
        audit.frontmatter = fm;

        if (!fm.name) audit.errors.push('frontmatter.name mancante');
        if (!Array.isArray(fm.paths) || fm.paths.length === 0) {
            audit.errors.push('frontmatter.paths deve essere array non vuoto');
        } else {
            for (const glob of fm.paths) {
                if (!globMatchesAnyFile(glob)) {
                    audit.errors.push(`glob non matcha alcun file/dir: ${glob}`);
                }
            }
        }
        if (!Array.isArray(fm.enforcement) || fm.enforcement.length === 0) {
            audit.warnings.push('frontmatter.enforcement vuoto (raccomandato dichiarare hook/audit)');
        }

        if (!pluginRulesFiles.includes(file)) {
            audit.errors.push(`non elencato in .claude-plugin/plugin.json contents.rules.files`);
        }

        if (!readmeRuleNames.includes(file)) {
            audit.warnings.push(`non elencato nella tabella di .claude/rules/README.md`);
        }

        audits.push(audit);
    }

    for (const a of audits) {
        const status = a.errors.length === 0 ? '✅' : '❌';
        const warnTag = a.warnings.length > 0 ? ` (${a.warnings.length} warn)` : '';
        console.log(`${status} ${a.file}${warnTag}`);
        for (const err of a.errors) {
            console.log(`   ❌ ${err}`);
            totalErrors += 1;
        }
        for (const warn of a.warnings) {
            console.log(`   ⚠️  ${warn}`);
        }
    }

    const passed = audits.filter((a) => a.errors.length === 0).length;
    console.log(`\nResult: ${passed}/${audits.length} rules valide, ${totalErrors} errori totali\n`);
    process.exit(totalErrors > 0 ? 1 : 0);
}

run();
