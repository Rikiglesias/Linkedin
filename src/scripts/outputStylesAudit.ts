/**
 * outputStylesAudit.ts
 *
 * Verifica che gli output style Claude Code riusabili vivano a livello utente
 * e che il progetto non mantenga copie divergenti.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

interface StyleSpec {
    fileName: string;
    expectedName: string;
    requiredSnippet: string;
}

const userOutputStylesDir = join(homedir(), '.claude', 'output-styles');
const projectOutputStylesDir = resolve('.claude', 'output-styles');

const requiredStyles: StyleSpec[] = [
    {
        fileName: 'italian-concise.md',
        expectedName: 'italian-concise',
        requiredSnippet: 'Override italiano utile quando Caveman ultra',
    },
    {
        fileName: 'terse.md',
        expectedName: 'terse',
        requiredSnippet: 'Code-only responses',
    },
];

function readText(path: string): string | null {
    if (!existsSync(path)) {
        return null;
    }
    return readFileSync(path, 'utf8');
}

function parseFrontmatter(text: string): Record<string, string> | null {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) {
        return null;
    }

    const entries = match[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex === -1) {
                return null;
            }
            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            return [key, value] as const;
        })
        .filter((entry): entry is readonly [string, string] => entry !== null);

    return Object.fromEntries(entries);
}

function checkUserStyles(): CheckResult {
    const missing: string[] = [];

    for (const style of requiredStyles) {
        const path = join(userOutputStylesDir, style.fileName);
        const text = readText(path);
        const frontmatter = text ? parseFrontmatter(text) : null;

        if (!text) {
            missing.push(`${style.fileName}: file mancante`);
            continue;
        }
        if (!frontmatter) {
            missing.push(`${style.fileName}: frontmatter mancante`);
            continue;
        }
        if (frontmatter.name !== style.expectedName) {
            missing.push(`${style.fileName}: name atteso ${style.expectedName}`);
        }
        if (!frontmatter.description) {
            missing.push(`${style.fileName}: description mancante`);
        }
        if (!text.includes(style.requiredSnippet)) {
            missing.push(`${style.fileName}: snippet richiesto assente`);
        }
    }

    if (missing.length > 0) {
        return {
            name: 'Output styles user-scope',
            passed: false,
            detail: missing.join(' | '),
        };
    }

    return {
        name: 'Output styles user-scope',
        passed: true,
        detail: `${requiredStyles.length} style globali validi in ${userOutputStylesDir}`,
    };
}

function checkProjectCopiesRemoved(): CheckResult {
    if (!existsSync(projectOutputStylesDir)) {
        return {
            name: 'Nessuna copia project-scope',
            passed: true,
            detail: 'Directory project-scope assente.',
        };
    }

    const localStyleFiles = readdirSync(projectOutputStylesDir)
        .filter((fileName) => fileName.endsWith('.md'))
        .filter((fileName) => fileName.toLowerCase() !== 'readme.md');

    if (localStyleFiles.length > 0) {
        return {
            name: 'Nessuna copia project-scope',
            passed: false,
            detail: `Style locali rimasti: ${localStyleFiles.join(', ')}`,
        };
    }

    return {
        name: 'Nessuna copia project-scope',
        passed: true,
        detail: 'Solo README project-scope rimasto come puntatore.',
    };
}

function checkCavemanStateDocumented(): CheckResult {
    const activePath = join(homedir(), '.claude', '.caveman-active');
    const statePath = join(homedir(), '.claude', 'caveman-state.txt');
    const state = readText(activePath)?.trim() || readText(statePath)?.trim() || 'inactive';
    const italianStyle = readText(join(userOutputStylesDir, 'italian-concise.md'));

    if (state === 'ultra' && !italianStyle?.includes('Caveman ultra')) {
        return {
            name: 'Caveman ultra italiano',
            passed: false,
            detail: 'Caveman ultra attivo ma italian-concise non documenta override italiano.',
        };
    }

    return {
        name: 'Caveman ultra italiano',
        passed: true,
        detail: `Stato Caveman rilevato: ${state}.`,
    };
}

function run(): void {
    const checks = [checkUserStyles(), checkProjectCopiesRemoved(), checkCavemanStateDocumented()];
    let allPassed = true;

    console.log('\n=== Output Styles Audit ===\n');
    for (const check of checks) {
        const marker = check.passed ? '[OK]' : '[FAIL]';
        console.log(`${marker} ${check.name}`);
        console.log(`     ${check.detail}`);
        if (!check.passed) {
            allPassed = false;
        }
    }

    const passed = checks.filter((check) => check.passed).length;
    console.log(`\n${passed}/${checks.length} check passati.\n`);

    if (!allPassed) {
        process.exit(1);
    }
}

run();
