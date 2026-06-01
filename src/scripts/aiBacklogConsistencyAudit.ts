/**
 * aiBacklogConsistencyAudit.ts
 *
 * Blocca il drift tra backlog madre AI, vista lineare e priorita' attive.
 *
 * Regola zero-trust: un punto non e' chiuso perche' una checklist lo dice.
 * Il report canonico deve contenere evidenza, stato reale e verifica richiesta.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join, resolve } from 'path';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

interface SectionCounts {
    point: number;
    title: string;
    done: number;
    open: number;
    total: number;
}

interface ReportSnapshot {
    fileName: string;
    content: string;
}

function readText(path: string): string {
    if (!existsSync(path)) {
        throw new Error(`File non trovato: ${path}`);
    }
    return readFileSync(path, 'utf8');
}

function extractSections(text: string, headingPattern: RegExp): SectionCounts[] {
    const matches = [...text.matchAll(headingPattern)];
    return matches.map((match, index) => {
        const start = match.index ?? 0;
        const next = matches[index + 1];
        const end = next?.index ?? text.length;
        const body = text.slice(start, end);
        const pointText = match[1];
        const title = match[2]?.trim() ?? '';
        const done = (body.match(/^- \[[xX]\]/gm) ?? []).length;
        const open = (body.match(/^- \[ \]/gm) ?? []).length;
        return {
            point: Number(pointText),
            title,
            done,
            open,
            total: done + open,
        };
    });
}

function latestZeroTrustReport(): ReportSnapshot | null {
    const trackingDir = resolve('docs', 'tracking');
    if (!existsSync(trackingDir)) {
        return null;
    }

    const reports = readdirSync(trackingDir)
        .filter((file) => /^AI_POINT_BY_POINT_AUDIT_\d{4}-\d{2}-\d{2}\.md$/.test(file))
        .sort();
    const latest = reports[reports.length - 1];
    if (!latest) {
        return null;
    }

    const fullPath = join(trackingDir, latest);
    return {
        fileName: latest,
        content: readText(fullPath),
    };
}

function checkSectionCounts(masterText: string, globalText: string): CheckResult {
    const masterSections = extractSections(masterText, /^## (\d+)\. (.+)$/gm);
    const globalSections = extractSections(globalText, /^### (\d+)\. (.+)$/gm);

    if (masterSections.length !== 13 || globalSections.length !== 13) {
        return {
            name: 'Backlog e vista lineare contengono 13 punti',
            passed: false,
            detail: `master=${masterSections.length}, global=${globalSections.length}`,
        };
    }

    const mismatches: string[] = [];
    for (let point = 1; point <= 13; point += 1) {
        const master = masterSections.find((section) => section.point === point);
        const global = globalSections.find((section) => section.point === point);
        if (!master || !global) {
            mismatches.push(`#${point}: sezione mancante`);
            continue;
        }

        if (master.done !== global.done || master.open !== global.open || master.total !== global.total) {
            mismatches.push(
                `#${point}: master ${master.done}/${master.total} done, global ${global.done}/${global.total} done`,
            );
        }
    }

    if (mismatches.length > 0) {
        return {
            name: 'Checkbox backlog madre = vista lineare',
            passed: false,
            detail: mismatches.join(' | '),
        };
    }

    const summary = masterSections
        .map((section) => `#${section.point} ${section.done}/${section.total}`)
        .join(', ');
    return {
        name: 'Checkbox backlog madre = vista lineare',
        passed: true,
        detail: summary,
    };
}

function checkZeroTrustReport(report: ReportSnapshot | null): CheckResult {
    if (!report) {
        return {
            name: 'Report zero-trust canonico presente',
            passed: false,
            detail: 'Nessun docs/tracking/AI_POINT_BY_POINT_AUDIT_YYYY-MM-DD.md trovato.',
        };
    }

    const requiredSnippets = [
        'Metodo zero-trust',
        'Testo originale',
        'Fonte canonica',
        'Evidenza trovata',
        'Stato reale',
        'Cosa manca',
        'Miglioramento proposto',
        'Verifica richiesta',
    ];
    const missing = requiredSnippets.filter((snippet) => !report.content.includes(snippet));
    const missingPoints = Array.from({ length: 13 }, (_, index) => index + 1).filter(
        (point) => !new RegExp(`^## Punto ${point}\\b`, 'm').test(report.content),
    );

    if (missing.length > 0 || missingPoints.length > 0) {
        const details = [
            missing.length > 0 ? `campi mancanti: ${missing.join(', ')}` : '',
            missingPoints.length > 0 ? `punti mancanti: ${missingPoints.join(', ')}` : '',
        ].filter(Boolean);
        return {
            name: 'Report zero-trust canonico completo',
            passed: false,
            detail: `${report.fileName}: ${details.join(' | ')}`,
        };
    }

    return {
        name: 'Report zero-trust canonico completo',
        passed: true,
        detail: report.fileName,
    };
}

function checkActiveTodos(todosText: string, report: ReportSnapshot | null): CheckResult {
    if (!report) {
        return {
            name: 'active.md punta al report zero-trust',
            passed: false,
            detail: 'Report zero-trust assente.',
        };
    }

    const required = ['ZERO_TRUST_AI_AUDIT', report.fileName, 'chiuso provato', 'parziale', 'aperto reale'];
    const missing = required.filter((snippet) => !todosText.includes(snippet));

    if (missing.length > 0) {
        return {
            name: 'active.md punta al report zero-trust',
            passed: false,
            detail: `Mancano in todos/active.md: ${missing.join(', ')}`,
        };
    }

    return {
        name: 'active.md punta al report zero-trust',
        passed: true,
        detail: `${basename(report.fileName)} referenziato con stati reali.`,
    };
}

function run(): void {
    const masterText = readText(resolve('docs', 'AI_MASTER_IMPLEMENTATION_BACKLOG.md'));
    const globalText = readText(resolve('docs', 'AI_IMPLEMENTATION_LIST_GLOBAL.md'));
    const todosText = readText(resolve('todos', 'active.md'));
    const report = latestZeroTrustReport();

    const checks: CheckResult[] = [
        checkSectionCounts(masterText, globalText),
        checkZeroTrustReport(report),
        checkActiveTodos(todosText, report),
    ];

    console.log('\n=== AI Backlog Consistency Audit ===\n');

    let allPassed = true;
    for (const check of checks) {
        const icon = check.passed ? '✅' : '❌';
        console.log(`${icon} ${check.name}`);
        console.log(`   → ${check.detail}`);
        if (!check.passed) {
            allPassed = false;
        }
    }

    const passed = checks.filter((check) => check.passed).length;
    console.log(`\n--- ${passed}/${checks.length} check passati ---`);

    if (!allPassed) {
        process.exit(1);
    }
}

run();
