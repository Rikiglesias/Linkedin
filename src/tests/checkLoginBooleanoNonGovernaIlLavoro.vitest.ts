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
import os from 'os';
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

/**
 * Nomi locali sotto cui `checkLogin` entra in un file: l'identificatore nudo, ogni alias
 * (`import { checkLogin as verifica }`) e ogni namespace import (`import * as auth` → `auth.checkLogin`).
 * Senza questo, la sentinella si aggirava rinominando l'import — il difetto rientrava in silenzio.
 */
function nomiLocaliDiCheckLogin(source: ts.SourceFile): { diretti: Set<string>; namespace: Set<string> } {
    const diretti = new Set<string>(['checkLogin']);
    const namespace = new Set<string>();
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
        const bindings = statement.importClause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
            namespace.add(bindings.name.text);
        } else if (bindings && ts.isNamedImports(bindings)) {
            for (const specifier of bindings.elements) {
                const originale = specifier.propertyName?.text ?? specifier.name.text;
                if (originale === 'checkLogin') diretti.add(specifier.name.text);
            }
        }
    }
    return { diretti, namespace };
}

/** Chiamate VERE a `checkLogin(...)` (AST: CallExpression; stringhe e commenti non contano). */
function chiamateCheckLogin(radice: string = SRC): Chiamata[] {
    const trovate: Chiamata[] = [];
    for (const file of listTsFiles(radice)) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const { diretti, namespace } = nomiLocaliDiCheckLogin(source);
        const visita = (node: ts.Node): void => {
            const chiamataDiretta =
                ts.isCallExpression(node) && ts.isIdentifier(node.expression) && diretti.has(node.expression.text);
            const chiamataSuNamespace =
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                namespace.has(node.expression.expression.text) &&
                node.expression.name.text === 'checkLogin';
            if (chiamataDiretta || chiamataSuNamespace) {
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

    it('controllo positivo: il rilevatore vede davvero una violazione nuova, alias compreso', () => {
        // Prima confrontava due letterali e sarebbe passato anche col rilevatore rotto (B6 della
        // review). Ora scrive un file vero sotto `src/` e lo fa analizzare: se la scansione o la
        // risoluzione degli alias smettessero di funzionare, questo test fallirebbe.
        // Il file finto vive in una cartella TEMPORANEA, mai dentro `src/`: altri test scansionano
        // l'albero sorgente in parallelo e un file che appare e sparisce li fa fallire a caso
        // (successo davvero: `identityInitSessionDir` è morto con ENOENT alla prima esecuzione).
        const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'c27-controllo-'));
        const finto = path.join(cartella, 'fintoWorker.ts');
        fs.writeFileSync(
            finto,
            [
                "import { checkLogin as verificaSessione } from '../browser';",
                'export async function lavoroFinto(page: unknown): Promise<void> {',
                '    if (await verificaSessione(page as never)) return;',
                '}',
                '',
            ].join(String.fromCharCode(10)),
            'utf8',
        );
        try {
            const consentite = new Set(CONSENTITI.map(chiave));
            const violazioni = chiamateCheckLogin(cartella).filter((c) => !consentite.has(chiave(c)));
            expect(violazioni.map((c) => c.funzione)).toContain('lavoroFinto');
        } finally {
            fs.rmSync(cartella, { recursive: true, force: true });
        }
    });
});
