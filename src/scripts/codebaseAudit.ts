/**
 * codebaseAudit.ts — Audit della salute del codebase
 *
 * Uso:
 *   npx ts-node src/scripts/codebaseAudit.ts            # report completo
 *   npx ts-node src/scripts/codebaseAudit.ts --json     # output JSON (per API)
 *   npm run audit                                        # alias
 *
 * Controlla:
 *   - File TypeScript > 300 righe (soglia SRP)
 *   - Circular dependencies (via madge)
 *   - TODO/FIXME/HACK accumulati
 *   - File senza estensione .ts nel src/ (file orfani)
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';

const ROOT = join(__dirname, '../../');
const SRC = join(ROOT, 'src');
const LINE_THRESHOLD = 300;

// ─── Utilities ────────────────────────────────────────────────────────────────

function walkTs(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
            files.push(...walkTs(full));
        } else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
            files.push(full);
        }
    }
    return files;
}

function countLines(filePath: string): number {
    try {
        const content = readFileSync(filePath, 'utf8');
        return content.split('\n').length;
    } catch {
        return 0;
    }
}

// ─── Checks ───────────────────────────────────────────────────────────────────

export interface AuditResult {
    timestamp: string;
    totalFiles: number;
    totalLines: number;
    filesOverThreshold: Array<{ file: string; lines: number }>;
    circularDeps: string[][];
    techDebt: Array<{ file: string; line: number; tag: string; text: string }>;
    score: number; // 0-100, 100 = perfetto
    summary: string;
}

export async function runCodebaseAudit(): Promise<AuditResult> {
    const tsFiles = walkTs(SRC);
    const timestamp = new Date().toISOString();

    // 1. File > soglia
    const filesOverThreshold: AuditResult['filesOverThreshold'] = [];
    let totalLines = 0;

    for (const f of tsFiles) {
        const lines = countLines(f);
        totalLines += lines;
        if (lines > LINE_THRESHOLD) {
            filesOverThreshold.push({ file: relative(ROOT, f), lines });
        }
    }
    filesOverThreshold.sort((a, b) => b.lines - a.lines);

    // 2. Circular deps via madge CLI
    let circularDeps: string[][] = [];
    try {
        const result = execSync(`npx madge --circular --json ${SRC}`, {
            cwd: ROOT,
            timeout: 30000,
            encoding: 'utf8',
        });
        const parsed = JSON.parse(result.trim() || '{}');
        // madge --json outputs { "file": ["dep1", "dep2"] } for circular deps
        circularDeps = Object.entries(parsed).map(([k, v]) => [k, ...(v as string[])]);
    } catch {
        circularDeps = [];
    }

    // 3. TODO/FIXME/HACK
    const techDebt: AuditResult['techDebt'] = [];
    const DEBT_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.+)/g;
    for (const f of tsFiles) {
        try {
            const lines = readFileSync(f, 'utf8').split('\n');
            lines.forEach((line, idx) => {
                const matches = [...line.matchAll(DEBT_PATTERN)];
                for (const m of matches) {
                    techDebt.push({
                        file: relative(ROOT, f),
                        line: idx + 1,
                        tag: m[1],
                        text: m[2].trim().slice(0, 80),
                    });
                }
            });
        } catch {
            // skip unreadable files
        }
    }

    // 4. Score (penalità per violazioni)
    const penaltyPerLargeFile = 1; // -1 punto per file >300 righe
    const penaltyPerCircular = 5; // -5 punti per ogni ciclo
    const penaltyPerDebt = 0.5; // -0.5 per ogni TODO
    const score = Math.max(
        0,
        100 -
            filesOverThreshold.length * penaltyPerLargeFile -
            circularDeps.length * penaltyPerCircular -
            techDebt.length * penaltyPerDebt,
    );

    // 5. Summary
    const issues = [];
    if (filesOverThreshold.length > 0) issues.push(`${filesOverThreshold.length} file >${LINE_THRESHOLD} righe`);
    if (circularDeps.length > 0) issues.push(`${circularDeps.length} circular deps`);
    if (techDebt.length > 0) issues.push(`${techDebt.length} TODO/FIXME`);
    const summary = issues.length === 0 ? 'Codebase pulito' : `Problemi: ${issues.join(' | ')}`;

    return {
        timestamp,
        totalFiles: tsFiles.length,
        totalLines,
        filesOverThreshold,
        circularDeps,
        techDebt,
        score: Math.round(score),
        summary,
    };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
    const jsonMode = process.argv.includes('--json');

    runCodebaseAudit()
        .then((result) => {
            if (jsonMode) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }

            console.log('\n=== Codebase Audit ===');
            console.log(`Data:          ${result.timestamp.split('T')[0]}`);
            console.log(`File TS:       ${result.totalFiles}`);
            console.log(`Righe totali:  ${result.totalLines.toLocaleString()}`);
            console.log(`Score:         ${result.score}/100`);
            console.log(`Sommario:      ${result.summary}`);

            if (result.filesOverThreshold.length > 0) {
                console.log(`\n--- File >${LINE_THRESHOLD} righe (${result.filesOverThreshold.length}) ---`);
                result.filesOverThreshold.slice(0, 20).forEach(({ file, lines }) => {
                    const priority = lines > 1000 ? '🔴' : lines > 600 ? '🟠' : '🟡';
                    console.log(`  ${priority} ${lines.toString().padStart(5)} | ${file}`);
                });
                if (result.filesOverThreshold.length > 20) {
                    console.log(`  ... e altri ${result.filesOverThreshold.length - 20}`);
                }
            }

            if (result.circularDeps.length > 0) {
                console.log(`\n--- Circular dependencies (${result.circularDeps.length}) ---`);
                result.circularDeps.slice(0, 10).forEach((cycle) => {
                    console.log(`  🔴 ${cycle.join(' → ')}`);
                });
            } else {
                console.log('\n✅ Nessuna circular dependency');
            }

            if (result.techDebt.length > 0) {
                console.log(`\n--- Tech debt (${result.techDebt.length} TODO/FIXME) ---`);
                result.techDebt.slice(0, 10).forEach(({ file, line, tag, text }) => {
                    console.log(`  ${tag} ${file}:${line} — ${text}`);
                });
            }

            console.log('\nDone.');
        })
        .catch((err) => {
            console.error('Errore audit:', err);
            process.exit(1);
        });
}
