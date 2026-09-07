/**
 * preflightIdentityOffline.vitest.ts — C26 chunk 3 del contratto `bot-operativo` (blocco A).
 *
 * Il comando `preflight-identity --offline` risponde a UNA domanda prima del login: cio' che la PAGINA
 * vede coincide con l'identita' che il profilo dichiara nel suo `.fingerprint.json`? Se non coincide,
 * il profilo si presenta a LinkedIn con due facce diverse — il segnale che C23/C24 esistono per evitare.
 *
 * Tre proprieta', tutte verificate qui:
 *  (a) coerente -> `coherent: true`, exit 0, e il JSON porta i sei campi contrattuali;
 *  (b) INCOERENTE (caso negativo da ARTEFATTO, mai da env di test: un `.fingerprint.json` diverso da cio'
 *      che la pagina misura) -> `coherent: false`, exit 1, con i campi divergenti NOMINATI;
 *  (c) il lancio reale passa `allowDirectIp: true`: e' diagnostica su pagina locale, quindi il fail-closed
 *      di C26/1 la bloccherebbe su un profilo con cookie — l'uscita esplicita e' voluta e va dichiarata,
 *      non scoperta in produzione. Guardia anti-regressione sul SORGENTE, come nel chunk 2.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Snapshot } from '../browser/identitySnapshot';
import type { PersistedBrowserIdentity } from '../browser/browserIdentity';
import { runPreflightIdentityCommand, type PreflightIdentityDeps } from '../cli/commands/preflightIdentity';

const SORGENTE = fs.readFileSync(path.resolve(__dirname, '..', 'cli', 'commands', 'preflightIdentity.ts'), 'utf8');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

const tempDirs: string[] = [];
function sessionDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c26-preflight-'));
    tempDirs.push(dir);
    return dir;
}

function identita(over: Partial<PersistedBrowserIdentity> = {}): PersistedBrowserIdentity {
    return {
        schemaVersion: 1,
        accountId: 'default',
        engine: 'camoufox',
        engineBuild: '135.0',
        os: 'windows',
        fontsSpacingSeed: 42,
        createdAt: '2026-09-07T10:00:00.000Z',
        fingerprintId: 'fp-1',
        userAgent: UA,
        locale: 'it-IT',
        languages: ['it-IT', 'it'],
        timezone: 'Europe/Rome',
        viewport: { width: 1366, height: 707 },
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
        hardwareConcurrency: 8,
        deviceMemory: null,
        colorDepth: 24,
        ja3: 'ja3-x',
        ...over,
    } as PersistedBrowserIdentity;
}

function osservato(over: Partial<Snapshot> = {}): Snapshot {
    return {
        userAgent: UA,
        platform: 'Win32',
        oscpu: 'Windows NT 10.0; Win64; x64',
        hardwareConcurrency: 8,
        languages: ['it-IT', 'it'],
        screen: { width: 1920, height: 1080, colorDepth: 24 },
        outer: { width: 1366, height: 768 },
        inner: { width: 1366, height: 707 },
        fontWidths: [1, 2, 3],
        repeatedWidthsEqual: true,
        deviceMemory: undefined,
        performanceMemory: undefined,
        natives: { fontsCheck: true, measureText: true, permissionsQuery: true, webdriverGetter: true, innerWidthGetter: true },
        ownProps: { navigator: [], screen: [] },
        webdriver: undefined,
        notificationPermission: 'default',
        notificationsQueryState: 'prompt',
        timeZone: 'Europe/Rome',
        fontsCheckUnknownFamily: true,
        fontProbe: { segoeMono: 319.5, mono: 318.5, segoeSans: 300, sans: 290 },
        ...over,
    };
}

function deps(dir: string, snap: Snapshot, id: PersistedBrowserIdentity | null = identita()): PreflightIdentityDeps {
    return {
        resolveTarget: () => ({ sessionDir: dir, accountId: 'default' }),
        readIdentity: () => id,
        observe: async () => snap,
    };
}

let scritto: string[];
let spia: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    scritto = [];
    process.exitCode = 0;
    spia = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        scritto.push(String(chunk));
        return true;
    });
});
afterEach(() => {
    spia.mockRestore();
    process.exitCode = 0;
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
    }
});

function payload(): Record<string, unknown> {
    return JSON.parse(scritto.join('')) as Record<string, unknown>;
}

describe('C26/3 — preflight-identity --offline', () => {
    it('pagina e file identita concordi -> coherent true, exit 0, sei campi contrattuali', async () => {
        await runPreflightIdentityCommand(['--offline'], deps(sessionDir(), osservato()));
        const out = payload();
        expect(out.coherent).toBe(true);
        expect(process.exitCode).toBe(0);
        for (const campo of ['engine', 'os', 'ua', 'tz', 'locale', 'coherent']) {
            expect(out, `campo contrattuale mancante: ${campo}`).toHaveProperty(campo);
        }
        expect(out.engine).toBe('camoufox');
        expect(out.tz).toBe('Europe/Rome');
    });

    it('userAgent della pagina diverso dal file -> coherent false, exit 1, campo NOMINATO', async () => {
        const altro = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';
        await runPreflightIdentityCommand(['--offline'], deps(sessionDir(), osservato({ userAgent: altro })));
        const out = payload();
        expect(out.coherent).toBe(false);
        expect(process.exitCode).toBe(1);
        expect(JSON.stringify(out.mismatches)).toContain('userAgent');
    });

    it('timezone della pagina diverso dal file -> coherent false, exit 1', async () => {
        await runPreflightIdentityCommand(['--offline'], deps(sessionDir(), osservato({ timeZone: 'America/New_York' })));
        const out = payload();
        expect(out.coherent).toBe(false);
        expect(process.exitCode).toBe(1);
        expect(JSON.stringify(out.mismatches)).toContain('timezone');
    });

    it('locale della pagina diverso dal file -> coherent false, exit 1', async () => {
        await runPreflightIdentityCommand(['--offline'], deps(sessionDir(), osservato({ languages: ['en-US', 'en'] })));
        const out = payload();
        expect(out.coherent).toBe(false);
        expect(JSON.stringify(out.mismatches)).toContain('locale');
    });

    it('sessionDir SENZA .fingerprint.json -> exit 1 e codice esplicito, nessun browser da aprire', async () => {
        const dir = sessionDir();
        let lanciato = false;
        await runPreflightIdentityCommand(['--offline'], {
            resolveTarget: () => ({ sessionDir: dir, accountId: 'default' }),
            readIdentity: () => null,
            observe: async () => {
                lanciato = true;
                return osservato();
            },
        });
        const out = payload();
        expect(out.ok).toBe(false);
        expect(out.code).toBe('IDENTITY_FILE_MISSING');
        expect(process.exitCode).toBe(1);
        expect(lanciato, 'senza identita non ci sono due facce da confrontare: il browser non si apre').toBe(false);
    });

    it('il lancio reale e diagnostica: allowDirectIp esplicito, altrimenti il fail-closed di C26/1 lo blocca', () => {
        expect(SORGENTE).toMatch(/allowDirectIp:\s*true/);
        expect(SORGENTE).toMatch(/bypassProxy:\s*true/);
    });

    it('la pagina misurata e una COSTANTE locale: allowDirectIp non diventa una porta per uscire in diretta', () => {
        // `allowDirectIp: true` e' la deroga al fail-closed di C26/1 ed e' legittima SOLO finche' non esce
        // nulla in rete. Se il comando accettasse una URL parametrica, un profilo con i cookie di LinkedIn
        // uscirebbe dall'IP reale: qui la destinazione e' una costante, e nessun flag la puo' cambiare.
        expect(SORGENTE).toMatch(/const PAGINA_LOCALE = 'about:blank'/);
        const gotoCalls = SORGENTE.match(/\.goto\(([^)]*)\)/g) ?? [];
        expect(gotoCalls).toEqual(['.goto(PAGINA_LOCALE)']);
        // Nessun flag che scelga la destinazione e nessuna URL di rete come STRINGA nel codice
        // (i commenti possono nominare linkedin.com: e' il codice che non deve poterci arrivare).
        expect(SORGENTE).not.toMatch(/'--url'|"--url"/);
        expect(SORGENTE).not.toMatch(/['"`]https?:\/\//);
    });

    it('il browser viene sempre chiuso, anche se la misura fallisce', () => {
        expect(SORGENTE).toMatch(/finally/);
        expect(SORGENTE).toMatch(/closeBrowser/);
    });

    it('identita nella forma REALE (senza timezone persistita) -> nessun mismatch inventato, tz comunque riportata', async () => {
        // Misurato sul file scritto da `identity-init`: le chiavi NON contengono `timezone` (Camoufox la
        // deriva da geoip). Senza questo caso la fixture con `timezone` valorizzata farebbe credere che il
        // confronto tz sia una rete attiva in produzione: non lo e' — la coerenza tz-vs-paese e' della
        // diagnosi proxy. Stesso difetto trovato in C25 (test che conferma invece di verificare).
        const reale = identita();
        delete (reale as { timezone?: string }).timezone;
        await runPreflightIdentityCommand(['--offline'], deps(sessionDir(), osservato({ timeZone: 'America/New_York' }), reale));
        const out = payload();
        expect(out.coherent).toBe(true);
        expect(out.tz).toBe('America/New_York');
        expect(JSON.stringify(out.mismatches)).not.toContain('timezone');
    });

    it('registrato nella CLI: case, whitelist di setup, stdout JSON e help', () => {
        const index = fs.readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf8');
        const jsonStdout = fs.readFileSync(path.resolve(__dirname, '..', 'cli', 'jsonStdout.ts'), 'utf8');
        const help = fs.readFileSync(path.resolve(__dirname, '..', 'cli', 'commandHelp.ts'), 'utf8');
        expect(index).toContain("case 'preflight-identity'");
        // Diagnostico read-only: deve poter girare PRIMA che il setup sia completo, come `preflight-env`.
        expect(index).toMatch(/const safeCommands = \[[^\]]*'preflight-identity'/);
        expect(jsonStdout).toContain("'preflight-identity'");
        expect(help).toContain("'preflight-identity': {");
    });
});
