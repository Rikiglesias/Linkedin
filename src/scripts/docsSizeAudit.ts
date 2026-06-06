/**
 * docsSizeAudit.ts — Verifica dimensione canonici docs/ e propone split
 *
 * Item 12 backlog AI: cleanup AI-readable, file lunghi vanno splittati o restano
 * accettabili solo se sono canonici/storici dichiarati.
 *
 * Soglie:
 * - AGENTS.md / CLAUDE.md adapter / runtime brief: SOFT 250, HARD 500
 * - Canonici lista madre/vista/spec/operating model: SOFT 700, HARD 1200
 * - Documenti di tracking: SOFT 400, HARD 800
 *
 * Uso:
 *   npm run audit:docs-size
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface CanonicalSpec {
    path: string;
    softLimit: number;
    hardLimit: number;
    category: string;
    rationale: string;
}

interface SizeResult {
    file: string;
    lines: number;
    bytes: number;
    softLimit: number;
    hardLimit: number;
    status: 'OK' | 'WARN' | 'OVER';
    rationale: string;
}

const REPO_ROOT = process.cwd();

const CANONICALS: CanonicalSpec[] = [
    {
        path: 'AGENTS.md',
        softLimit: 500,
        hardLimit: 700,
        category: 'operativo-progetto',
        rationale: 'Regole operative repo: accettabile sopra 200 righe, oltre 700 va modulato',
    },
    {
        path: 'CLAUDE.md',
        softLimit: 200,
        hardLimit: 300,
        category: 'adapter',
        rationale: 'Adapter Claude Code: convention community sotto 200 righe',
    },
    {
        path: 'docs/AI_RUNTIME_BRIEF.md',
        softLimit: 150,
        hardLimit: 250,
        category: 'runtime-brief',
        rationale: 'Reiniettato a ogni prompt: deve restare compatto',
    },
    // Doc ADK (master spec, backlog ADK, implementation-list globale, operating model) migrati in
    // AI-Control-Plane/spec via adk-split: non più monitorati da questo audit di igiene del repo.
    {
        path: 'docs/360-checklist.md',
        softLimit: 200,
        hardLimit: 400,
        category: 'checklist',
        rationale: 'Checklist 360 corta e azionabile',
    },
];

const TRACKING_DIR = join(REPO_ROOT, 'docs', 'tracking');
const TRACKING_SOFT = 400;
const TRACKING_HARD = 800;

function countLines(path: string): number {
    if (!existsSync(path)) return -1;
    try {
        return readFileSync(path, 'utf8').split('\n').length;
    } catch {
        return -1;
    }
}

function countBytes(path: string): number {
    if (!existsSync(path)) return -1;
    try {
        return statSync(path).size;
    } catch {
        return -1;
    }
}

function analyzeFile(absPath: string, displayPath: string, softLimit: number, hardLimit: number, rationale: string): SizeResult | null {
    const lines = countLines(absPath);
    if (lines < 0) return null;
    const bytes = countBytes(absPath);
    let status: SizeResult['status'] = 'OK';
    if (lines > hardLimit) status = 'OVER';
    else if (lines > softLimit) status = 'WARN';
    return { file: displayPath, lines, bytes, softLimit, hardLimit, status, rationale };
}

function listTrackingFiles(): string[] {
    if (!existsSync(TRACKING_DIR)) return [];
    try {
        return readdirSync(TRACKING_DIR).filter((f) => f.endsWith('.md'));
    } catch {
        return [];
    }
}

function run(): void {
    console.log('=== Docs Size Audit ===\n');
    const today = new Date().toISOString().slice(0, 10);
    console.log(`Data: ${today}`);
    console.log(`Repo: ${REPO_ROOT}\n`);

    const results: SizeResult[] = [];

    console.log('--- Canonici principali ---');
    for (const spec of CANONICALS) {
        const absPath = join(REPO_ROOT, spec.path);
        const r = analyzeFile(absPath, spec.path, spec.softLimit, spec.hardLimit, spec.rationale);
        if (!r) {
            console.log(`❓ ${spec.path} non trovato`);
            continue;
        }
        results.push(r);
        const icon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
        console.log(`${icon} ${r.file}: ${r.lines} righe (soft ${r.softLimit} / hard ${r.hardLimit}) [${spec.category}]`);
        if (r.status !== 'OK') {
            console.log(`   → ${r.rationale}`);
        }
    }

    console.log('\n--- Tracking docs (docs/tracking/) ---');
    const trackingFiles = listTrackingFiles();
    for (const file of trackingFiles) {
        const absPath = join(TRACKING_DIR, file);
        const r = analyzeFile(absPath, `docs/tracking/${file}`, TRACKING_SOFT, TRACKING_HARD, 'Tracking docs: soft 400, hard 800');
        if (!r) continue;
        results.push(r);
        const icon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
        console.log(`${icon} ${r.file}: ${r.lines} righe`);
    }

    const over = results.filter((r) => r.status === 'OVER');
    const warn = results.filter((r) => r.status === 'WARN');

    console.log('\n--- Sintesi ---');
    console.log(`Totale file analizzati: ${results.length}`);
    console.log(`OK: ${results.filter((r) => r.status === 'OK').length}`);
    console.log(`WARN (oltre soft limit): ${warn.length}`);
    console.log(`OVER (oltre hard limit, split richiesto): ${over.length}`);

    if (over.length > 0) {
        console.log('\nFile da modulare/split:');
        for (const r of over) {
            console.log(`  - ${r.file}: ${r.lines} righe > hard ${r.hardLimit}`);
        }
    }

    if (warn.length > 0) {
        console.log('\nFile sotto osservazione (vicini al limite):');
        for (const r of warn) {
            console.log(`  - ${r.file}: ${r.lines} righe (soft ${r.softLimit})`);
        }
    }

    if (over.length === 0) {
        console.log('\n✅ Nessun canonico oltre hard limit. Pulizia struttura OK.');
    } else {
        console.log('\n⚠️ Alcuni canonici sono diventati monoliti. Valutare split per tema/sezione.');
    }
}

run();
