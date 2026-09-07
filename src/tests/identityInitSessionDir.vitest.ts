/**
 * identityInitSessionDir.vitest.ts — C53 del contratto `bot-operativo`: `identity-init` ha un contratto
 * e la cartella di sessione di un account ha UNA sola risoluzione.
 *
 * Il buco che chiude: la regola «account → cartella» era ripetuta in punti diversi (`config.sessionDir`
 * letto a mano in `accountManager`, nel launcher, nell'arricchimento aziende, nella sonda WebRTC). Due
 * risposte diverse alla stessa domanda significano `login` che scrive i cookie in una cartella e
 * `send-invites` che ne apre un'altra: per LinkedIn sono due dispositivi diversi sullo stesso account.
 * Qui la funzione unica è `resolveSessionDir(accountId)` e nessun altro punto legge `config.sessionDir`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getAccountProfileById, getRuntimeAccountProfiles, resolveSessionDir } from '../accountManager';
import { config } from '../config';
import {
    createBrowserIdentity,
    hostIdentityOs,
    IDENTITY_FILE_NAME,
    type GeneratedIdentity,
    type PersistedBrowserIdentity,
} from '../browser/browserIdentity';
import { resolveIdentityInitTarget, runIdentityInitCommand } from '../cli/commands/identityInit';
import { resolveProfileDir } from '../scripts/createProfile';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const TESTS_DIR = path.join(SRC, 'tests');

function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (full === TESTS_DIR) continue;
            out.push(...listTsFiles(full));
        } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** Letture VERE di `config.sessionDir` (AST: accesso a proprietà; stringhe e commenti non contano). */
function lettureConfigSessionDir(file: string): number[] {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const righe: number[] = [];
    const visita = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            node.name.text === 'sessionDir' &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'config'
        ) {
            righe.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
        }
        ts.forEachChild(node, visita);
    };
    visita(source);
    return righe;
}

function tmpDir(nome: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `c53-${nome}-`));
}

type CreateIdentity = (sessionDir: string, accountId: string) => Promise<PersistedBrowserIdentity>;

/** Cattura stdout JSON ed exit code del comando, come fa il resto della suite CLI. */
async function eseguiComando(
    args: string[],
    createIdentity: CreateIdentity,
    resolveTarget = resolveIdentityInitTarget,
): Promise<{ exitCode: number | string | undefined; out: Record<string, unknown> }> {
    const righe: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const precedente = process.exitCode;
    process.exitCode = undefined;
    process.stdout.write = ((chunk: string | Uint8Array) => {
        righe.push(String(chunk));
        return true;
    }) as typeof process.stdout.write;
    try {
        await runIdentityInitCommand(args, { resolveTarget, createIdentity });
        return { exitCode: process.exitCode, out: JSON.parse(righe.join('')) as Record<string, unknown> };
    } finally {
        process.stdout.write = write;
        process.exitCode = precedente;
    }
}

/** Ciò che il generatore produrrebbe: forma minima valida per Camoufox (UA Firefox coerente col binario). */
function identitaGenerata(): GeneratedIdentity {
    return {
        fingerprintId: 'pool:desktop_firefox_win_1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
        locale: 'it-IT',
        languages: ['it-IT', 'it', 'en-US', 'en'],
        timezone: undefined,
        viewport: { width: 1920, height: 1080 },
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
        hardwareConcurrency: 8,
        deviceMemory: null,
        colorDepth: 24,
        ja3: 'test-ja3',
        browserforge: { navigator: { userAgent: 'Firefox/135.0' }, screen: { width: 1920, height: 1080 } },
    } as unknown as GeneratedIdentity;
}

function identitaFinta(accountId: string): PersistedBrowserIdentity {
    return {
        version: 1,
        accountId,
        engine: 'camoufox',
        engineBuild: '135.0',
        os: 'windows',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/135.0',
        fontsSpacingSeed: 42,
        createdAt: new Date().toISOString(),
    } as unknown as PersistedBrowserIdentity;
}

describe('C53 — una sola risoluzione della cartella di sessione', () => {
    it('resolveSessionDir e il solo punto che legge config.sessionDir in tutto src/ (test esclusi)', () => {
        const colpevoli: string[] = [];
        for (const file of listTsFiles(SRC)) {
            const righe = lettureConfigSessionDir(file);
            if (righe.length === 0) continue;
            const relativo = path.relative(ROOT, file).replace(/\\/g, '/');
            if (relativo === 'src/accountManager.ts') continue;
            colpevoli.push(`${relativo}:${righe.join(',')}`);
        }
        expect(colpevoli).toEqual([]);
    });

    it('in accountManager.ts la lettura vive SOLO dentro resolveSessionDir', () => {
        const file = path.join(SRC, 'accountManager.ts');
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const funzione = source.statements.find(
            (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'resolveSessionDir',
        );
        if (!funzione) throw new Error('resolveSessionDir deve essere una funzione dichiarata in accountManager.ts');
        const inizio = source.getLineAndCharacterOfPosition(funzione.getStart(source)).line + 1;
        const fine = source.getLineAndCharacterOfPosition(funzione.getEnd()).line + 1;
        const righe = lettureConfigSessionDir(file);
        expect(righe.length).toBeGreaterThan(0);
        expect(righe.filter((r) => r < inizio || r > fine)).toEqual([]);
    });

    it('la funzione da un path assoluto e stabile: default, nessun id e il profilo coincidono', () => {
        const conId = resolveSessionDir('default');
        const senzaId = resolveSessionDir();
        expect(path.isAbsolute(conId)).toBe(true);
        expect(senzaId).toBe(conId);
        expect(conId).toBe(path.resolve(getAccountProfileById('default').sessionDir));
        expect(conId).toBe(path.resolve(config.sessionDir));
    });

    it('invariante: per OGNI account il profilo e la funzione unica danno lo stesso path', () => {
        // I flussi che gia' hanno il profilo in mano (`send-invites` e i suoi fratelli: jobRunner,
        // syncSearch, salesnav, audit, doctor) passano `account.sessionDir` a `launchBrowser`. Non li
        // riscrivo — sarebbero 14 punti in area anti-ban per un valore identico — ma l'uguaglianza va
        // PROVATA, non assunta.
        //
        // LIMITE DICHIARATO (trovato dal critico di fine task, 2026-09-07): in questo ambiente
        // `multiAccountEnabled` è false, quindi `getRuntimeAccountProfiles()` restituisce il profilo
        // sintetico costruito con `sessionDir: resolveSessionDir()` — cioè questo caso confronta la
        // funzione con sé stessa sul ramo single-account, e NON dimostra nulla sul ramo multi-account
        // (dove i profili portano il loro `sessionDir` dalla configurazione). Il ramo multi-account
        // va coperto montando una config finta con due profili: tracciato in
        // `~/todos/improvements-proposed.md`. Finché non c'è, questo caso vale come guardia di
        // non-regressione del ramo attivo, non come prova dell'invariante generale.
        const profili = getRuntimeAccountProfiles();
        expect(profili.length).toBeGreaterThan(0);
        for (const profilo of profili) {
            expect(resolveSessionDir(profilo.id)).toBe(path.resolve(profilo.sessionDir));
            expect(path.isAbsolute(profilo.sessionDir)).toBe(true);
        }
    });

    it('forma: login e il lancio del browser (path di send-invites) passano dalla funzione unica', () => {
        const login = fs.readFileSync(path.join(SRC, 'cli', 'commands', 'utilCommands.ts'), 'utf8');
        const inizio = login.indexOf('export async function runLoginCommand');
        expect(inizio).toBeGreaterThan(0);
        const bloccoLogin = login.slice(inizio, login.indexOf('\nexport ', inizio + 1));
        // Una sola risoluzione per tutto il comando: il lancio del browser E la baseline di freschezza
        // (`recordSuccessfulAuth`) devono puntare alla stessa cartella, mai a due letture diverse.
        expect(bloccoLogin).toMatch(/const sessionDir = resolveSessionDir\(selectedAccount\.id\)/);
        expect(bloccoLogin).not.toMatch(/selectedAccount\.sessionDir/);
        expect(bloccoLogin).toMatch(/recordSuccessfulAuth\(sessionDir,/);
        const launcher = fs.readFileSync(path.join(SRC, 'browser', 'launcher.ts'), 'utf8');
        expect(launcher).toMatch(/options\.sessionDir \?\? resolveSessionDir\(options\.accountId\)/);
    });
});

describe('C53 — contratto di identity-init', () => {
    it('cartella pulita produce identita creata e path stampato', async () => {
        const dir = tmpDir('pulita');
        const { exitCode, out } = await eseguiComando(
            [],
            async (sessionDir, accountId) => {
                fs.writeFileSync(path.join(sessionDir, IDENTITY_FILE_NAME), JSON.stringify({ accountId }));
                return identitaFinta(accountId);
            },
            () => ({ sessionDir: dir, accountId: 'default', newSession: false }),
        );
        expect(exitCode).toBe(0);
        expect(out.ok).toBe(true);
        expect(out.created).toBe(true);
        expect(out.sessionDir).toBe(dir);
        expect(out.file).toBe(path.join(dir, IDENTITY_FILE_NAME));
        expect(fs.existsSync(path.join(dir, IDENTITY_FILE_NAME))).toBe(true);
    });

    it('cartella con cookie e senza --new-session: exit diverso da 0, mtime invariata, 0 scritture', async () => {
        const dir = tmpDir('cookie');
        const jar = path.join(dir, 'Default');
        fs.mkdirSync(jar, { recursive: true });
        fs.writeFileSync(path.join(jar, 'Cookies'), 'cookie-jar');
        fs.writeFileSync(path.join(dir, 'Cookies'), 'cookie-jar');
        const primaFile = fs.readdirSync(dir).sort();
        const primaMtime = fs.statSync(dir).mtimeMs;
        let creazioni = 0;
        const { exitCode, out } = await eseguiComando(
            [],
            async () => {
                creazioni++;
                throw new Error('non deve essere chiamato');
            },
            () => ({ sessionDir: dir, accountId: 'default', newSession: false }),
        );
        expect(exitCode).toBe(1);
        expect(out.code).toBe('IDENTITY_PROFILE_HAS_COOKIES');
        expect(String(out.error)).toContain('--new-session');
        expect(creazioni).toBe(0);
        expect(fs.readdirSync(dir).sort()).toEqual(primaFile);
        expect(fs.statSync(dir).mtimeMs).toBe(primaMtime);
        expect(fs.existsSync(path.join(dir, IDENTITY_FILE_NAME))).toBe(false);
    });

    it('cartella che NON esiste (il caso di --new-session) viene creata dal codice vero, con identita dentro', async () => {
        const base = tmpDir('nuova');
        const dir = path.join(base, 'sessione-che-non-esiste-ancora');
        expect(fs.existsSync(dir)).toBe(false);
        const { exitCode, out } = await eseguiComando(
            ['--new-session'],
            // Il vero scrittore: crea la cartella (mkdir ricorsivo) e pubblica il file in modo atomico.
            (sessionDir, accountId) =>
                createBrowserIdentity(
                    sessionDir,
                    accountId,
                    {
                        engine: 'camoufox',
                        engineBuild: '135.0.1-beta.24',
                        hostOs: hostIdentityOs(),
                        isUaCoherentWithEngine: (userAgent: string) => /Firefox\//.test(userAgent),
                    },
                    identitaGenerata(),
                ),
            () => ({ sessionDir: dir, accountId: 'default', newSession: true }),
        );
        expect(exitCode).toBe(0);
        expect(out.ok).toBe(true);
        expect(out.created).toBe(true);
        expect(fs.existsSync(path.join(dir, IDENTITY_FILE_NAME))).toBe(true);
        expect(fs.readdirSync(dir)).toEqual([IDENTITY_FILE_NAME]);
        const scritta = JSON.parse(fs.readFileSync(path.join(dir, IDENTITY_FILE_NAME), 'utf8')) as { os: string; accountId: string };
        expect(scritta.accountId).toBe('default');
        expect(scritta.os).toBe(hostIdentityOs());
    });

    it('--new-session e letto dall handler: cartella NUOVA accanto a quella risolta dalla funzione unica', () => {
        const base = resolveIdentityInitTarget([]);
        const nuova = resolveIdentityInitTarget(['--new-session']);
        expect(base.newSession).toBe(false);
        expect(nuova.newSession).toBe(true);
        expect(nuova.sessionDir).not.toBe(base.sessionDir);
        expect(nuova.sessionDir.startsWith(base.sessionDir)).toBe(true);
        expect(path.isAbsolute(nuova.sessionDir)).toBe(true);
        expect(base.sessionDir).toBe(resolveSessionDir(base.accountId));
    });

    it('--new-session stampa la riga di configurazione col path nuovo; senza flag non la stampa', async () => {
        const dir = tmpDir('hint');
        const conFlag = await eseguiComando(
            ['--new-session'],
            async (_sessionDir, accountId) => identitaFinta(accountId),
            () => ({ sessionDir: dir, accountId: 'default', newSession: true }),
        );
        expect(conFlag.exitCode).toBe(0);
        expect(String(conFlag.out.configHint)).toContain(`SESSION_DIR=${dir}`);
        const senzaFlag = await eseguiComando(
            [],
            async (_sessionDir, accountId) => identitaFinta(accountId),
            () => ({ sessionDir: tmpDir('hint2'), accountId: 'default', newSession: false }),
        );
        expect(senzaFlag.out.configHint).toBeNull();
    });
});

describe('F-7c1a9e04 — create-profile apre la stessa cartella di login', () => {
    // Il critico di fine task ha trovato che `create-profile` fa un login LinkedIn REALE su un default
    // hardcoded (`<cwd>/profiles/linkedin-profile`) mentre `login`/`send-invites`/`identity-init`
    // risolvono la funzione unica: due cookie jar e due `.fingerprint.json` per lo stesso account,
    // cioe' due dispositivi per LinkedIn. Stesso buco di C53, su un comando che C53 non aveva toccato.
    it('senza --dir il profilo e la cartella della funzione unica, non una costante di modulo', () => {
        expect(resolveProfileDir(undefined)).toBe(resolveSessionDir());
        expect(resolveProfileDir(null)).toBe(resolveSessionDir());
        expect(resolveProfileDir('   ')).toBe(resolveSessionDir());
    });

    it('--account sceglie la cartella di QUEL account, come fa login', () => {
        for (const profilo of getRuntimeAccountProfiles()) {
            expect(resolveProfileDir(undefined, profilo.id)).toBe(resolveSessionDir(profilo.id));
        }
    });

    it('--dir esplicito resta sovrano: assoluto invariato, relativo risolto sul cwd', () => {
        const assoluto = path.join(os.tmpdir(), 'c53-dir-esplicito');
        expect(resolveProfileDir(assoluto)).toBe(assoluto);
        expect(resolveProfileDir('profili/uno')).toBe(path.resolve(process.cwd(), 'profili', 'uno'));
    });

    it('nessun file di src/ costruisce piu una cartella di profilo hardcoded', () => {
        const colpevoli: string[] = [];
        for (const file of listTsFiles(SRC)) {
            const testo = fs.readFileSync(file, 'utf8');
            const source = ts.createSourceFile(file, testo, ts.ScriptTarget.Latest, true);
            const visita = (node: ts.Node): void => {
                if (ts.isStringLiteral(node) && node.text === 'linkedin-profile') {
                    colpevoli.push(
                        `${path.relative(ROOT, file).split(path.sep).join('/')}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
                    );
                }
                ts.forEachChild(node, visita);
            };
            visita(source);
        }
        expect(colpevoli).toEqual([]);
    });

    it('forma: il comando passa --account al resolver, non lo ignora', () => {
        const testo = fs.readFileSync(path.join(SRC, 'cli', 'commands', 'utilCommands.ts'), 'utf8');
        const inizio = testo.indexOf('export async function runCreateProfileCommand');
        expect(inizio).toBeGreaterThan(0);
        const blocco = testo.slice(inizio, testo.indexOf('\nexport ', inizio + 1));
        expect(blocco).toMatch(/getOptionValue\(args, '--account'\)/);
        expect(blocco).toMatch(/resolveProfileDir\(dirRaw, /);
    });
});
