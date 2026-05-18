/**
 * autoTrackAudit.ts — Validation per entry auto-tracked in SESSION_FINDINGS.md
 *
 * Verifica:
 * 1. timestamp ISO 8601 valido in ogni entry "### [...]"
 * 2. session_id formato non-vuoto
 * 3. hash sha256 = 64 char hex
 * 4. source ∈ {stop, subagent-stop, session-end}
 * 5. pattern ∈ {TODO_FUTURO, FIX_TRACCIATO, SPRINT_DEDICATO, BLOCKED, DECISIONE}
 * 6. nessun placeholder TODO/PLACEHOLDER nel content
 * 7. nessun duplicato (hash+pattern)
 *
 * Uso: npx ts-node src/scripts/autoTrackAudit.ts
 *      npm run audit:auto-track
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FINDINGS_PATH = path.join(REPO_ROOT, 'docs', 'tracking', 'SESSION_FINDINGS.md');

const VALID_PATTERNS = new Set([
    'TODO_FUTURO',
    'FIX_TRACCIATO',
    'SPRINT_DEDICATO',
    'BLOCKED',
    'DECISIONE',
]);

const VALID_SOURCES = new Set(['stop', 'subagent-stop', 'session-end']);

interface Entry {
    line: number;
    timestamp: string;
    pattern: string;
    sessionId: string;
    hash: string;
    source: string;
    content: string;
}

interface AuditIssue {
    line: number;
    severity: 'error' | 'warn';
    message: string;
}

function parseEntries(content: string): { entries: Entry[]; parseErrors: AuditIssue[] } {
    const entries: Entry[] = [];
    const parseErrors: AuditIssue[] = [];
    const lines = content.split(/\r?\n/);
    const headerRe = /^### \[(?<ts>[^\]]+)\] pattern=(?<pattern>\S+) session=(?<session>\S+) hash=(?<hash>\S+) source=(?<source>\S+)/;

    let insideCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('```')) {
            insideCodeBlock = !insideCodeBlock;
            continue;
        }
        if (insideCodeBlock) continue;
        const m = lines[i].match(headerRe);
        if (!m || !m.groups) continue;

        let contentBody = '';
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].startsWith('### ')) break;
            if (lines[j].startsWith('## ')) break;
            if (lines[j].startsWith('> ')) {
                contentBody += lines[j].substring(2) + '\n';
            }
        }

        entries.push({
            line: i + 1,
            timestamp: m.groups.ts,
            pattern: m.groups.pattern,
            sessionId: m.groups.session,
            hash: m.groups.hash,
            source: m.groups.source,
            content: contentBody.trim(),
        });
    }

    return { entries, parseErrors };
}

function validateEntry(e: Entry, issues: AuditIssue[]): void {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(e.timestamp)) {
        issues.push({ line: e.line, severity: 'error', message: `timestamp non ISO 8601: ${e.timestamp}` });
    }
    if (!VALID_PATTERNS.has(e.pattern)) {
        issues.push({ line: e.line, severity: 'error', message: `pattern invalido: ${e.pattern}` });
    }
    if (!e.sessionId || e.sessionId.length < 4) {
        issues.push({ line: e.line, severity: 'error', message: `session_id assente/troppo corto: ${e.sessionId}` });
    }
    if (!/^[a-f0-9]{64}$/.test(e.hash)) {
        issues.push({ line: e.line, severity: 'error', message: `hash non SHA-256 hex 64char: ${e.hash}` });
    }
    if (!VALID_SOURCES.has(e.source)) {
        issues.push({ line: e.line, severity: 'error', message: `source invalido: ${e.source}` });
    }
    const placeholderRe = /\b(TODO|PLACEHOLDER|FIXME|XXX)\b/i;
    if (placeholderRe.test(e.content) && e.pattern !== 'TODO_FUTURO') {
        issues.push({ line: e.line, severity: 'warn', message: `content contiene placeholder: ${e.content.substring(0, 60)}` });
    }
    if (e.content.length === 0) {
        issues.push({ line: e.line, severity: 'error', message: 'content vuoto' });
    }
}

function checkDuplicates(entries: Entry[], issues: AuditIssue[]): void {
    const seen = new Map<string, number>();
    for (const e of entries) {
        const key = `${e.hash}::${e.pattern}`;
        if (seen.has(key)) {
            issues.push({
                line: e.line,
                severity: 'error',
                message: `duplicato hash+pattern (prima occorrenza linea ${seen.get(key)})`,
            });
        } else {
            seen.set(key, e.line);
        }
    }
}

function run(): void {
    console.log('\n=== Auto-Track Findings Audit ===');
    console.log(`File: ${FINDINGS_PATH}`);
    console.log(`Data: ${new Date().toISOString().split('T')[0]}\n`);

    if (!fs.existsSync(FINDINGS_PATH)) {
        console.log('⚠️  SESSION_FINDINGS.md non esiste. Skip.');
        process.exit(0);
    }

    const content = fs.readFileSync(FINDINGS_PATH, 'utf8');

    if (!/^auto-tracked:\s*true/m.test(content)) {
        console.log('❌ Frontmatter manca campo "auto-tracked: true"');
        process.exit(1);
    }

    const { entries, parseErrors } = parseEntries(content);
    const issues: AuditIssue[] = [...parseErrors];

    for (const e of entries) {
        validateEntry(e, issues);
    }
    checkDuplicates(entries, issues);

    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warn');

    console.log(`Entry trovate: ${entries.length}`);
    console.log(`Errori: ${errors.length}, Warning: ${warnings.length}\n`);

    if (issues.length > 0) {
        for (const issue of issues) {
            const icon = issue.severity === 'error' ? '❌' : '⚠️';
            console.log(`${icon} line ${issue.line}: ${issue.message}`);
        }
        console.log('');
    } else {
        console.log('✅ Tutte le entry auto-tracked sono valide.\n');
    }

    process.exit(errors.length > 0 ? 1 : 0);
}

run();
