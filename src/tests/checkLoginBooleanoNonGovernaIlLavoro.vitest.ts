/**
 * checkLoginBooleanoNonGovernaIlLavoro.vitest.ts — chiude la METÀ mancante della classe C27
 * («429 letto come logout»).
 *
 * Il buco che chiude: `checkLogin` collassa su `false` tre situazioni diverse — cookie scaduti,
 * throttling (429/403) e rete muta. Chi usa quel booleano per DECIDERE (far partire un lavoro,
 * dire a un umano «rifai il login», navigare a `/login`) sotto un 429 fa esattamente la cosa che
 * LinkedIn sta chiedendo di non fare. C27 ha spostato canary, job runner e i due sync sulla
 * politica unica; restavano fuori i chiamanti di questo file.
 *
 * L'invariante è sul GRAFO, non su un singolo fix: chi decide usa `checkLoginDetailed` (lettura
 * tipizzata) o `valutaSessionePrimaDelLavoro` (lettura + reazione già applicata). Il booleano
 * sopravvive SOLO dove è davvero un booleano — la conferma di un login manuale con l'umano davanti
 * e un campo di report diagnostico — e quei siti sono elencati qui con il motivo.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const TESTS_DIR = path.join(SRC, 'tests');

/**
 * Siti dove il booleano `checkLogin` è legittimo, con il motivo. La sentinella confronta con
 * QUESTA lista: fallisce sia su un sito nuovo non elencato, sia su una voce che non esiste più
 * (una allowlist che invecchia in silenzio non è una rete).
 */
const CONSENTITI: { file: string; funzione: string; motivo: string }[] = [
    {
        file: 'src/cli/commands/utilCommands.ts',
        funzione: 'runLoginCommand',
        motivo: 'conferma di un login MANUALE con l\'umano alla tastiera: qui la domanda è davvero binaria',
    },
    {
        file: 'src/cli/commands/utilCommands.ts',
        funzione: 'runTestConnectionCommand',
        motivo: 'campo `loggedIn` di un report diagnostico: riporta, non decide',
    },
    {
        file: 'src/cli/commands/salesNavCommands.ts',
        funzione: 'waitForManualLinkedInLogin',
        motivo: 'stesso polling di login manuale, ramo SalesNav',
    },
];

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

/** Nome della funzione (o del metodo/arrow assegnato) che contiene il nodo. */
function funzioneContenitrice(node: ts.Node): string {
    let corrente: ts.Node | undefined = node.parent;
    while (corrente) {
        if (ts.isFunctionDeclaration(corrente) && corrente.name) return corrente.name.text;
        if (ts.isMethodDeclaration(corrente) && ts.isIdentifier(corrente.name)) return corrente.name.text;
        if (
            (ts.isFunctionExpression(corrente) || ts.isArrowFunction(corrente)) &&
            corrente.parent &&
            ts.isVariableDeclaration(corrente.parent) &&
            ts.isIdentifier(corrente.parent.name)
        ) {
            return corrente.parent.name.text;
        }
        corrente = corrente.parent;
    }
    return '<top-level>';
}

interface Chiamata {
    file: string;
    funzione: string;
    riga: number;
}

/** Chiamate VERE a `checkLogin(...)` (AST: CallExpression; stringhe e commenti non contano). */
function chiamateCheckLogin(): Chiamata[] {
    const trovate: Chiamata[] = [];
    for (const file of listTsFiles(SRC)) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const visita = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'checkLogin') {
                trovate.push({
                    file: path.relative(ROOT, file).split(path.sep).join('/'),
                    funzione: funzioneContenitrice(node),
                    riga: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                });
            }
            ts.forEachChild(node, visita);
        };
        visita(source);
    }
    return trovate;
}

const chiave = (c: { file: string; funzione: string }): string => `${c.file}#${c.funzione}`;

describe('C27 — il booleano checkLogin non governa il lavoro', () => {
    it('nessun sito nuovo usa il booleano fuori dalla allowlist motivata', () => {
        const consentite = new Set(CONSENTITI.map(chiave));
        const violazioni = chiamateCheckLogin()
            .filter((c) => !consentite.has(chiave(c)))
            .map((c) => `${c.file}:${c.riga} (${c.funzione})`);
        expect(violazioni).toEqual([]);
    });

    it('ogni voce della allowlist esiste ancora nel codice (niente rete che invecchia)', () => {
        const presenti = new Set(chiamateCheckLogin().map(chiave));
        const scomparse = CONSENTITI.filter((c) => !presenti.has(chiave(c))).map(chiave);
        expect(scomparse).toEqual([]);
    });

    it('controllo positivo: un sito finto fuori allowlist viene visto come violazione', () => {
        const consentite = new Set(CONSENTITI.map(chiave));
        const finto = { file: 'src/workers/fintoWorker.ts', funzione: 'processaQualcosa', riga: 1 };
        expect(consentite.has(chiave(finto))).toBe(false);
    });
});
