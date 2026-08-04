/**
 * Contratto del gate segreti pre-commit (`scripts/security/check-no-secrets.mjs`).
 *
 * Lo script gira come processo a sé (è un hook git), quindi qui viene eseguito davvero
 * dentro repo temporanei: è l'unico modo di verificare il comportamento reale del gate,
 * shell inclusa.
 *
 * I pattern di segreto sono composti a runtime ('AKIA' + …): scritti per esteso
 * farebbero bloccare il commit di questo stesso file dal gate che stanno testando.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCANNER = path.resolve(__dirname, '../../scripts/security/check-no-secrets.mjs');

// Chiave AWS sintatticamente valida (AKIA + 16 char) ma palesemente finta, e NON whitelistata.
const FAKE_AWS_KEY = 'AKIA' + 'Q'.repeat(16);
// Chiave OpenAI coperta dalla whitelist ("sk-XXX…"): deve restare permessa.
const WHITELISTED_KEY = 'sk-' + 'XXX' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';

let repo: string;

function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** Esegue il gate nel repo temporaneo. Non lancia: ritorna codice di uscita e output. */
function runScanner(): { code: number; out: string } {
    try {
        const out = execFileSync('node', [SCANNER], { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
        return { code: 0, out };
    } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
}

beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'seccheck-'));
    git('init', '-q', '.');
    git('config', 'user.email', 'test@test.local');
    git('config', 'user.name', 'test');
});

afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
});

describe('gate segreti — capability che deve restare (nessuna regressione)', () => {
    it('blocca un segreto vero in un file staged', () => {
        writeFileSync(path.join(repo, 'config.ts'), `const key = '${FAKE_AWS_KEY}';\n`);
        git('add', '-A');

        const { code, out } = runScanner();

        expect(code).toBe(1);
        expect(out).toContain('config.ts');
    });

    it('lascia passare un segreto palesemente fittizio (whitelist)', () => {
        writeFileSync(path.join(repo, 'fixture.ts'), `const key = '${WHITELISTED_KEY}';\n`);
        git('add', '-A');

        expect(runScanner().code).toBe(0);
    });

    it('non scansiona i file esclusi (lock, binari)', () => {
        writeFileSync(path.join(repo, 'package-lock.json'), `{"k":"${FAKE_AWS_KEY}"}\n`);
        git('add', '-A');

        expect(runScanner().code).toBe(0);
    });
});

describe('gate segreti — il nome del file non deve poter eseguire comandi', () => {
    it('non esegue il payload contenuto nel nome di un file staged', () => {
        // '&' è valido in un nome file (NTFS e POSIX) ed è un separatore di comandi per la shell.
        const hostile = 'a&copy NUL INJECTED.txt';
        writeFileSync(path.join(repo, hostile), 'contenuto innocuo\n');
        git('add', '-A');

        runScanner();

        expect(existsSync(path.join(repo, 'INJECTED.txt'))).toBe(false);
    });

    it('vede il contenuto di un file dal nome ostile invece di saltarlo in silenzio', () => {
        // Il difetto vero: se leggere il file fallisce, il segreto dentro non viene mai cercato.
        const hostile = 'b&echo x.ts';
        writeFileSync(path.join(repo, hostile), `const key = '${FAKE_AWS_KEY}';\n`);
        git('add', '-A');

        const { code } = runScanner();

        expect(code).toBe(1);
    });
});

describe('gate segreti — senza file staged non deve dichiarare un PASS a vuoto', () => {
    it('scansiona i file tracciati quando l\'area di stage è vuota', () => {
        // È il contesto dell'audit schedulato (`auditRunner`): commit già fatto, nulla in stage.
        writeFileSync(path.join(repo, 'leaked.ts'), `const key = '${FAKE_AWS_KEY}';\n`);
        git('add', '-A');
        git('commit', '-q', '-m', 'commit con segreto');

        expect(git('diff', '--cached', '--name-only').trim()).toBe('');

        const { code, out } = runScanner();

        expect(code).toBe(1);
        expect(out).toContain('leaked.ts');
    });

    it('dichiara quanti file ha scansionato e in che modalità', () => {
        writeFileSync(path.join(repo, 'pulito.ts'), 'export const ok = true;\n');
        git('add', '-A');

        const { code, out } = runScanner();

        expect(code).toBe(0);
        expect(out).toMatch(/1 file/);
    });
});

describe('gate segreti — la posizione riportata deve essere quella vera', () => {
    it('riporta la riga di ogni occorrenza dello stesso segreto, non due volte la prima', () => {
        // Con due segreti DIVERSI `indexOf` era già corretto: il difetto si vede solo
        // quando lo stesso valore compare più volte.
        const content = [
            `const a = '${FAKE_AWS_KEY}';`,
            '',
            '',
            '',
            `const b = '${FAKE_AWS_KEY}';`,
            '',
        ].join('\n');
        writeFileSync(path.join(repo, 'due.ts'), content);
        git('add', '-A');

        const { code, out } = runScanner();

        expect(code).toBe(1);
        expect(out).toContain('due.ts:1');
        expect(out).toContain('due.ts:5');
    });
});
