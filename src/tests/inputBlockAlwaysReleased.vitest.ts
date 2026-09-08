/**
 * inputBlockAlwaysReleased.vitest.ts — criterio C29: la proprieta' dell'input dura TUTTO il gesto,
 * si rilascia sempre, e se non si acquisisce il gesto non parte.
 *
 * I tre buchi che chiude, misurati alla fonte prima del fix:
 *  1. il watchdog lato pagina di `pauseInputBlock` era di 150 ms FISSI, ma il gesto di click dura
 *     pre-click 40-259 ms + dwell del bottone 40-109 ms: l'overlay tornava opaco A META' GESTO e
 *     il mousedown/mouseup del bot aveva come target il nostro div full-screen, non il bottone;
 *  2. `pauseInputBlock` ingoiava l'errore della `evaluate` (`catch {}`): il click partiva su un
 *     input di cui il bot non aveva la proprieta', e il chiamante lo contava come eseguito;
 *  3. `smartClick` (`bulkSaveHelpers.ts`) chiamava `resumeInputBlock` FUORI da un `finally`: un
 *     click che rigetta lasciava l'overlay trasparente fino allo scadere del watchdog.
 *
 * La rete di sicurezza NON viene tolta: il watchdog resta, dimensionato sul gesto e comunque
 * clampato sotto il secondo, perche' e' l'unica cosa che ripristina l'overlay se il processo muore
 * fra la pausa e la ripresa.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const TESTS_DIR = path.join(SRC, 'tests');

/** Coppie pausa -> ripresa che questa sentinella sorveglia. */
const COPPIE: { pausa: string; ripresa: string }[] = [
    { pausa: 'pauseInputBlock', ripresa: 'resumeInputBlock' },
    { pausa: 'pauseInputBlockForMove', ripresa: 'resumeInputBlockForMove' },
];

/**
 * `ensureInputBlock` NON e' fra le coppie di proposito: inietta l'overlay, non sospende nulla, e non
 * ha una `resume` corrispondente nell'API. Metterlo qui renderebbe la sentinella sempre rossa senza
 * descrivere un difetto reale. Il suo problema separato (la `evaluate` di iniezione e' best effort,
 * quindi un overlay mai iniettato non si vede) e' un'altra classe.
 */
const NON_SORVEGLIATE = ['ensureInputBlock'];

/**
 * Punti dove la pausa NON e' seguita da una ripresa nello stesso `finally`, con il motivo. La
 * sentinella confronta con QUESTA lista: fallisce sia su un sito nuovo non elencato, sia su una voce
 * che non esiste piu' (una allowlist che invecchia in silenzio non e' una rete).
 */
const CONSENTITI: { file: string; funzione: string; motivo: string }[] = [
    {
        file: 'src/salesnav/bulkSaveNavigation.ts',
        funzione: 'waitForManualLogin',
        motivo:
            "unico punto in cui la pausa non protegge un gesto del bot: cede il controllo all'utente per il login manuale, e due righe sotto removeAllOverlays toglie l'overlay del tutto",
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

/**
 * Nomi locali sotto cui una funzione entra in un file: l'identificatore nudo, ogni alias
 * (`import { pauseInputBlock as pausa }`) e ogni namespace import (`import * as hb` ->
 * `hb.pauseInputBlock`). Senza questo la sentinella si aggira rinominando l'import — difetto gia'
 * visto e chiuso sul finding M4 della review precedente.
 */
function nomiLocali(source: ts.SourceFile, originale: string): { diretti: Set<string>; namespace: Set<string> } {
    const diretti = new Set<string>([originale]);
    const namespace = new Set<string>();
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
        const bindings = statement.importClause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
            namespace.add(bindings.name.text);
        } else if (bindings && ts.isNamedImports(bindings)) {
            for (const specifier of bindings.elements) {
                const nome = specifier.propertyName?.text ?? specifier.name.text;
                if (nome === originale) diretti.add(specifier.name.text);
            }
        }
    }
    return { diretti, namespace };
}

function eChiamataA(
    call: ts.CallExpression,
    nomi: { diretti: Set<string>; namespace: Set<string> },
    originale: string,
): boolean {
    const expr = call.expression;
    if (ts.isIdentifier(expr)) return nomi.diretti.has(expr.text);
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
        return nomi.namespace.has(expr.expression.text) && expr.name.text === originale;
    }
    return false;
}

/** Statement che contiene direttamente il nodo dentro un blocco (per trovarne il fratello dopo). */
function statementContenitore(node: ts.Node): ts.Statement | undefined {
    let corrente: ts.Node | undefined = node;
    while (corrente && corrente.parent) {
        const genitore: ts.Node = corrente.parent;
        if (ts.isBlock(genitore) || ts.isSourceFile(genitore) || ts.isCaseClause(genitore) || ts.isDefaultClause(genitore)) {
            return corrente as ts.Statement;
        }
        corrente = genitore;
    }
    return undefined;
}

/** Gli statement fratelli del blocco (o del `case`) che contiene lo statement dato. */
function fratelli(statement: ts.Statement): readonly ts.Statement[] | undefined {
    const genitore = statement.parent;
    if (ts.isBlock(genitore) || ts.isSourceFile(genitore)) return genitore.statements;
    if (ts.isCaseClause(genitore) || ts.isDefaultClause(genitore)) return genitore.statements;
    return undefined;
}

/**
 * La ripresa deve stare nel `finally` del `try` ANCORATO alla pausa: il `try` dev'essere lo statement
 * IMMEDIATAMENTE successivo a quello della pausa, nello stesso blocco.
 *
 * La prima versione accettava un `try/finally` qualsiasi piu' avanti nella stessa funzione, e in una
 * funzione con piu' pause (`computerUse.executeAction` ne ha quattro in uno switch, con quattro
 * `finally`) solo l'ULTIMA era davvero sorvegliata: togliendo il `finally` al `case 'click'` la
 * sentinella restava verde. Trovato dalla review indipendente del 2026-09-08 con una fixture mutata;
 * la mia contro-prova non l'aveva visto perche' aveva mutato `smartClick`, l'unico sito con UNA pausa
 * e UN `finally`, cioe' l'unico in cui il difetto non puo' manifestarsi.
 */
function ripresaNelFinally(
    chiamataPausa: ts.CallExpression,
    nomiRipresa: { diretti: Set<string>; namespace: Set<string> },
    originaleRipresa: string,
): boolean {
    const statement = statementContenitore(chiamataPausa);
    if (!statement) return false;
    const lista = fratelli(statement);
    if (!lista) return false;
    const indice = lista.indexOf(statement);
    if (indice < 0 || indice + 1 >= lista.length) return false;
    const successivo = lista[indice + 1];
    if (!ts.isTryStatement(successivo) || !successivo.finallyBlock) return false;

    let trovata = false;
    const cerca = (n: ts.Node): void => {
        if (trovata) return;
        if (ts.isCallExpression(n) && eChiamataA(n, nomiRipresa, originaleRipresa)) trovata = true;
        ts.forEachChild(n, cerca);
    };
    cerca(successivo.finallyBlock);
    return trovata;
}

interface Violazione {
    file: string;
    funzione: string;
    riga: number;
    coppia: string;
}

export function scansionaInputBlock(radice: string = SRC): {
    violazioni: Violazione[];
    consentitiVisti: Set<string>;
    totalePause: number;
} {
    const violazioni: Violazione[] = [];
    const consentitiVisti = new Set<string>();
    let totalePause = 0;

    for (const file of listTsFiles(radice)) {
        const testo = fs.readFileSync(file, 'utf8');
        const source = ts.createSourceFile(file, testo, ts.ScriptTarget.Latest, true);
        const relativo = path.relative(ROOT, file).replace(/\\/g, '/');

        for (const { pausa, ripresa } of COPPIE) {
            const nomiPausa = nomiLocali(source, pausa);
            const nomiRipresa = nomiLocali(source, ripresa);

            const visita = (node: ts.Node): void => {
                if (ts.isCallExpression(node) && eChiamataA(node, nomiPausa, pausa)) {
                    const funzione = funzioneContenitrice(node);
                    // La DEFINIZIONE della funzione non e' un call site da sorvegliare.
                    if (funzione !== pausa) {
                        totalePause += 1;
                        const riga = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                        const chiave = `${relativo}#${funzione}`;
                        if (CONSENTITI.some((c) => c.file === relativo && c.funzione === funzione)) {
                            consentitiVisti.add(chiave);
                        } else if (!ripresaNelFinally(node, nomiRipresa, ripresa)) {
                            violazioni.push({ file: relativo, funzione, riga, coppia: `${pausa}/${ripresa}` });
                        }
                    }
                }
                ts.forEachChild(node, visita);
            };
            visita(source);
        }
    }
    return { violazioni, consentitiVisti, totalePause };
}

describe('C29 — la pausa dell input-block si rilascia SEMPRE (sentinella AST)', () => {
    const esito = scansionaInputBlock();

    it('ogni pausa ha la sua ripresa in un finally', () => {
        expect(esito.violazioni, JSON.stringify(esito.violazioni, null, 2)).toEqual([]);
    });

    it('la scansione vede davvero dei call site (sonda non muta)', () => {
        expect(esito.totalePause).toBeGreaterThanOrEqual(8);
    });

    it('ogni voce della allowlist corrisponde ancora a un call site reale', () => {
        const mancanti = CONSENTITI.filter((c) => !esito.consentitiVisti.has(`${c.file}#${c.funzione}`)).map(
            (c) => `${c.file}#${c.funzione}`,
        );
        expect(mancanti, 'voci di allowlist senza piu un call site corrispondente').toEqual([]);
    });

    it('ensureInputBlock resta fuori dalle coppie sorvegliate, con il motivo scritto', () => {
        expect(NON_SORVEGLIATE).toContain('ensureInputBlock');
        expect(COPPIE.map((c) => c.pausa)).not.toContain('ensureInputBlock');
    });
});

/**
 * Siti che catturano un errore per PROVARE UN'ALTRA STRADA e che quindi devono rilanciare il
 * fail-closed. Lista versionata: fallisce sia se un sito perde la guardia, sia se un sito
 * elencato non esiste piu' (finding A1 della review 2026-09-08).
 */
const DEVONO_RILANCIARE: { file: string; funzione: string; motivo: string }[] = [
    { file: 'src/browser/uiFallback.ts', funzione: 'clickWithFallback', motivo: 'prova i candidati successivi e poi il Vision Layer-Z' },
    { file: 'src/browser/uiFallback.ts', funzione: 'typeWithFallback', motivo: 'prova i candidati successivi' },
    { file: 'src/browser/uiFallback.ts', funzione: 'clickWithShadowFallback', motivo: 'ripiega sullo Shadow DOM' },
    { file: 'src/workers/inviteWorker.ts', funzione: 'clickConnectOnProfile', motivo: 'il false diventa SKIPPED connect_not_found, definitivo' },
    { file: 'src/workers/messageWorker.ts', funzione: 'processMessageJob', motivo: 'i due .catch che travestono l errore in TEXTBOX_NOT_FOUND / SEND_NOT_AVAILABLE e gonfiano selector_failures' },
];

describe('C29/A1 — il fail-closed non viene ingoiato da chi prova un altra strada', () => {
    it('la guardia rilancia SOLO InputBlockAcquireError', async () => {
        const { rilanciaSeInputNonAcquisito, InputBlockAcquireError } = await import('../browser/human/inputBlock');
        expect(() => rilanciaSeInputNonAcquisito(new InputBlockAcquireError('page_closed'))).toThrow(
            InputBlockAcquireError,
        );
        expect(() => rilanciaSeInputNonAcquisito(new Error('selettore non trovato'))).not.toThrow();
        expect(() => rilanciaSeInputNonAcquisito(undefined)).not.toThrow();
    });

    it('ogni sito dichiarato chiama la guardia, e ogni sito dichiarato esiste ancora', () => {
        const mancanti: string[] = [];
        for (const sito of DEVONO_RILANCIARE) {
            const testo = fs.readFileSync(path.join(ROOT, sito.file), 'utf8');
            const source = ts.createSourceFile(sito.file, testo, ts.ScriptTarget.Latest, true);
            let visto = false;
            const visita = (node: ts.Node): void => {
                if (
                    ts.isCallExpression(node) &&
                    ts.isIdentifier(node.expression) &&
                    node.expression.text === 'rilanciaSeInputNonAcquisito' &&
                    funzioneContenitrice(node) === sito.funzione
                ) {
                    visto = true;
                }
                ts.forEachChild(node, visita);
            };
            visita(source);
            if (!visto) mancanti.push(`${sito.file}#${sito.funzione} (${sito.motivo})`);
        }
        expect(mancanti, 'siti che catturano il fail-closed senza rilanciarlo').toEqual([]);
    });
});

// ─── Comportamento: acquisizione fail-closed e watchdog dimensionato ──────────

/** Pagina finta minima: registra cosa arriva alla `evaluate` e quanti click partono. */
function paginaFinta(opzioni: { chiusa?: boolean; evaluateRigetta?: boolean } = {}) {
    const argomenti: Record<string, unknown>[] = [];
    return {
        argomenti,
        page: {
            isClosed: () => opzioni.chiusa === true,
            evaluate: async (_fn: unknown, arg: Record<string, unknown>) => {
                if (opzioni.evaluateRigetta) throw new Error('Execution context was destroyed');
                argomenti.push(arg);
                return undefined;
            },
        },
    };
}

describe('C29 — acquisizione fail-closed', () => {
    it('pagina chiusa: lancia InputBlockAcquireError e non tocca la pagina', async () => {
        const { pauseInputBlock, InputBlockAcquireError } = await import('../browser/human/inputBlock');
        const { page, argomenti } = paginaFinta({ chiusa: true });
        await expect(pauseInputBlock(page as never)).rejects.toBeInstanceOf(InputBlockAcquireError);
        expect(argomenti).toEqual([]);
    });

    it('evaluate che fallisce: lancia invece di ingoiare (era `catch {}`)', async () => {
        const { pauseInputBlock, InputBlockAcquireError } = await import('../browser/human/inputBlock');
        const { page } = paginaFinta({ evaluateRigetta: true });
        await expect(pauseInputBlock(page as never)).rejects.toBeInstanceOf(InputBlockAcquireError);
        await expect(pauseInputBlock(page as never)).rejects.toThrow(/evaluate_failed/);
    });

    it('il watchdog resta, dimensionato e clampato dentro [150, 1000] ms', async () => {
        const { pauseInputBlock, INPUT_BLOCK_HOLD_MIN_MS, INPUT_BLOCK_HOLD_MAX_MS, INPUT_BLOCK_HOLD_DEFAULT_MS } =
            await import('../browser/human/inputBlock');
        const { page, argomenti } = paginaFinta();
        await pauseInputBlock(page as never);
        await pauseInputBlock(page as never, 5);
        await pauseInputBlock(page as never, 99_999);
        await pauseInputBlock(page as never, 670);
        expect(argomenti.map((a) => a.restoreAfterMs)).toEqual([
            INPUT_BLOCK_HOLD_DEFAULT_MS,
            INPUT_BLOCK_HOLD_MIN_MS,
            INPUT_BLOCK_HOLD_MAX_MS,
            670,
        ]);
        // Il criterio impone che la finestra resti sotto il secondo in OGNI caso.
        expect(INPUT_BLOCK_HOLD_MAX_MS).toBeLessThanOrEqual(1000);
    });
});

const mocksHb = vi.hoisted(() => ({
    pauseInputBlock: vi.fn(async (_page: unknown, _holdMs?: number) => undefined),
    resumeInputBlock: vi.fn(async (_page: unknown) => undefined),
    humanMouseMoveToCoords: vi.fn(async () => undefined),
    pulseVisualCursorOverlay: vi.fn(async () => undefined),
    ensureViewportDwell: vi.fn(async () => undefined),
}));

vi.mock('../browser/humanBehavior', () => ({
    pauseInputBlock: mocksHb.pauseInputBlock,
    resumeInputBlock: mocksHb.resumeInputBlock,
    humanMouseMoveToCoords: mocksHb.humanMouseMoveToCoords,
    pulseVisualCursorOverlay: mocksHb.pulseVisualCursorOverlay,
    ensureViewportDwell: mocksHb.ensureViewportDwell,
}));

/** I quattro numeri del gesto letti dal SORGENTE, gli stessi congelati da `timingCoreFrozen`. */
function numeriDelGesto(): number[] {
    const testo = fs.readFileSync(path.join(ROOT, 'src/browser/humanClick.ts'), 'utf8');
    const preClick = testo.match(
        /waitForTimeout\((\d+) \+ Math\.floor\(Math\.random\(\) \* Math\.random\(\) \* (\d+)\)\)/,
    );
    const clickDelay = testo.match(/delay: (\d+) \+ Math\.floor\(Math\.random\(\) \* (\d+)\)/);
    if (!preClick || !clickDelay) return [];
    return [Number(preClick[1]), Number(preClick[2]), Number(clickDelay[1]), Number(clickDelay[2])];
}

describe('C29 — il gesto di click possiede l input per tutta la sua durata', () => {
    beforeEach(() => {
        mocksHb.pauseInputBlock.mockClear();
        mocksHb.resumeInputBlock.mockClear();
        mocksHb.pauseInputBlock.mockImplementation(async () => undefined);
    });

    function pagina() {
        const click = vi.fn(async (_x: number, _y: number, _o?: unknown) => undefined);
        return {
            click,
            page: { waitForTimeout: async () => undefined, mouse: { click } },
        };
    }

    it('il watchdog copre TUTTO il gesto: hold >= durata massima delle due attese, e <= 1 s', async () => {
        const { clickCoordinatesHumanLike, GESTO_CLICK_DURATA_MAX_MS } = await import('../browser/humanClick');
        const { INPUT_BLOCK_HOLD_MAX_MS } = await import('../browser/human/inputBlock');
        const numeri = numeriDelGesto();
        expect(numeri, 'i quattro numeri del gesto non sono piu leggibili dal sorgente').toHaveLength(4);
        // Somma degli ESTREMI: pre-click (base + range) + dwell del bottone (base + range).
        const durataMassimaReale = numeri[0] + numeri[1] + numeri[2] + numeri[3];
        expect(GESTO_CLICK_DURATA_MAX_MS).toBe(durataMassimaReale);

        const { page } = pagina();
        await clickCoordinatesHumanLike(page as never, 10, 20);
        const hold = mocksHb.pauseInputBlock.mock.calls[0]?.[1];
        expect(typeof hold).toBe('number');
        expect(hold as number).toBeGreaterThan(durataMassimaReale);
        expect(hold as number).toBeLessThanOrEqual(INPUT_BLOCK_HOLD_MAX_MS);
    });

    it('click che rigetta: la ripresa parte ESATTAMENTE una volta e l errore risale', async () => {
        const { clickCoordinatesHumanLike } = await import('../browser/humanClick');
        const { page, click } = pagina();
        click.mockRejectedValueOnce(new Error('target closed'));
        await expect(clickCoordinatesHumanLike(page as never, 10, 20)).rejects.toThrow('target closed');
        expect(mocksHb.resumeInputBlock).toHaveBeenCalledTimes(1);
    });

    it('acquisizione fallita: ZERO click e nessuna ripresa di un blocco mai preso', async () => {
        const { clickCoordinatesHumanLike } = await import('../browser/humanClick');
        const { InputBlockAcquireError } = await import('../browser/human/inputBlock');
        mocksHb.pauseInputBlock.mockRejectedValueOnce(new InputBlockAcquireError('evaluate_failed', 'ctx destroyed'));
        const { page, click } = pagina();
        await expect(clickCoordinatesHumanLike(page as never, 10, 20)).rejects.toBeInstanceOf(InputBlockAcquireError);
        expect(click).toHaveBeenCalledTimes(0);
        expect(mocksHb.resumeInputBlock).toHaveBeenCalledTimes(0);
    });

    it('gesto riuscito: un solo click e una sola ripresa', async () => {
        const { clickCoordinatesHumanLike } = await import('../browser/humanClick');
        const { page, click } = pagina();
        await clickCoordinatesHumanLike(page as never, 10, 20);
        expect(click).toHaveBeenCalledTimes(1);
        expect(mocksHb.resumeInputBlock).toHaveBeenCalledTimes(1);
    });
});
