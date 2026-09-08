/**
 * timingCoreFrozen.vitest.ts — C63 del contratto `bot-operativo`, blocco B1: la BASELINE dei timing,
 * congelata PRIMA di toccare il gesto.
 *
 * A cosa serve: i criteri che vengono dopo (C29 input-block, C30 click grezzi, C31 throttle OS, C55
 * layer-Z) rimaneggiano il percorso del click. Un drift numerico introdotto per sbaglio in quel
 * lavoro non si vede a occhio e non rompe nessun test funzionale — ma cambia la firma temporale che
 * l'ML di LinkedIn misura. Qui le sequenze vengono trascritte: hash della sequenza intera, primi 20
 * valori in chiaro, statistiche informative. Se una formula cambia, questo test lo dice PRIMA che
 * il cambiamento arrivi su LinkedIn.
 *
 * Come si ottiene il determinismo (nessuna tolleranza, uguaglianza ESATTA):
 * - `Math.random` sostituito da un Mulberry32 a seme fisso, quindi le funzioni REALI producono
 *   sequenze riproducibili. Non si ricopiano le formule: si chiamano.
 * - orologio fissato (`vi.setSystemTime`), perche' `calculateContextualDelay` legge l'ora per il
 *   fattore di stanchezza.
 * - `ACCOUNT_ID` fissato, perche' la finestra di dwell e' centrata sul seme dell'account.
 * Cambiare uno di questi tre parametri cambia la baseline: sono scritti qui e sono parte del patto.
 *
 * Se il test fallisce dopo una modifica VOLUTA: rilancialo con `C63_PRINT=1` e incolla il blocco
 * stampato dentro `BASELINE`, in un commit che dichiara PERCHE' il timing e' cambiato.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', async (importOriginal) => {
    // `getHourInTimezone` resta la funzione VERA (fa parte del timing: decide il fattore di
    // stanchezza); si sostituiscono solo i valori di configurazione, per non dipendere dal .env.
    const reale = await importOriginal<typeof import('../config')>();
    return {
        ...reale,
        config: {
            ...reale.config,
            timezone: 'Europe/Rome',
            contextualPauseMinMs: 500,
            contextualPauseMaxMs: 2500,
        },
    };
});

vi.mock('crypto', async (importOriginal) => {
    // `utils/random` estrae da `crypto.randomInt`, non da `Math.random`: un CSPRNG non si semina,
    // quindi per congelare la FORMA della distribuzione lo si sostituisce QUI, nel test, senza
    // toccare la produzione. Cio' che questa baseline protegge e' la formula (mediana, sigma,
    // floor, clamp, ordine), non l'entropia: che la sorgente resti un CSPRNG e' un invariante a
    // parte, verificato dal test in fondo al file.
    const reale = await importOriginal<typeof import('crypto')>();
    return {
        ...reale,
        default: reale,
        randomInt: (a: number, b?: number): number =>
            b === undefined ? Math.floor(rnd() * a) : a + Math.floor(rnd() * (b - a)),
    };
});

vi.mock('../browser/deviceProfile', async (importOriginal) => {
    const reale = await importOriginal<typeof import('../browser/deviceProfile')>();
    // Solo il moltiplicatore di profilo e' fissato (dipende dall'account); il resto — ,
    // che decide fra percorso del mouse e swipe — resta VERO.
    return { ...reale, getPageDeviceProfile: () => ({ profileMultiplier: 1 }) };
});

vi.mock('../browser/humanBehavior', async () => {
    const reale = await vi.importActual<typeof import('../browser/human/humanDelay')>(
        '../browser/human/humanDelay',
    );
    const movimento = await vi.importActual<typeof import('../browser/human/mouseMovement')>(
        '../browser/human/mouseMovement',
    );
    return {
        // `ensureViewportDwell` e `humanMouseMoveToCoords` restano REALI: sono timing, e il movimento
        // del mouse e' anzi la componente PIU' GRANDE dell'attesa fra osservazione e click
        // (`mouseMovement.ts:140-150`: durata ~ Fitts, un `waitForTimeout` log-normale per ogni punto
        // del percorso). Restano finti solo gli overlay e il blocco input, che non producono attese.
        ensureViewportDwell: reale.ensureViewportDwell,
        humanMouseMoveToCoords: movimento.humanMouseMoveToCoords,
        pulseVisualCursorOverlay: async () => undefined,
        pauseInputBlock: async () => undefined,
        resumeInputBlock: async () => undefined,
    };
});

import { humanDelay, ensureViewportDwell } from '../browser/human/humanDelay';
import {
    fattoreLunghezzaTesto,
    finestraDwellDellAccount,
    humanKeystrokeDelayMs,
    humanKeystrokeDwellMs,
} from '../browser/human/keystrokeTiming';
import { clickCoordinatesHumanLike, clickLocatorHumanLike } from '../browser/humanClick';
import { updateMouseState } from '../browser/human/mouseState';

// ─── Parametri del patto (cambiarli cambia la baseline) ──────────────────────
const SEME = 0xc63;
const ORA_FISSA = '2026-09-08T10:00:00.000Z';
const ACCOUNT_BASELINE = 'c63-baseline';
const N_PRIMITIVE = 1000;
const N_CATENA = 200;
const VALORI_IN_CHIARO = 20;

/** Lo stato del generatore vive in un contenitore hoisted: i `vi.mock` lo leggono prima dei test. */
const stato = vi.hoisted(() => ({ rnd: (): number => 0 }));
const rnd = (): number => stato.rnd();

/** Mulberry32: PRNG deterministico a 32 bit, lo stesso usato dallo stealth del progetto. */
function mulberry32(seme: number): () => number {
    let a = seme >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seminaDaCapo(): void {
    stato.rnd = mulberry32(SEME);
}

function hash(sequenza: number[]): string {
    return crypto.createHash('sha256').update(sequenza.join(',')).digest('hex');
}

function statistiche(sequenza: number[]): { mean: number; p50: number; p95: number } {
    const ordinata = [...sequenza].sort((a, b) => a - b);
    const somma = sequenza.reduce((acc, v) => acc + v, 0);
    return {
        mean: Math.round((somma / sequenza.length) * 100) / 100,
        p50: ordinata[Math.floor(ordinata.length * 0.5)],
        p95: ordinata[Math.floor(ordinata.length * 0.95)],
    };
}

/** Pagina finta che REGISTRA ogni attesa invece di dormirci. */
function paginaCheRegistra(attese: number[], clickDelays: number[]) {
    return {
        waitForTimeout: async (ms: number) => {
            attese.push(ms);
        },
        locator: () => ({
            first: () => ({
                isVisible: async () => true,
                scrollIntoViewIfNeeded: async () => undefined,
            }),
        }),
        isClosed: () => false,
        viewportSize: () => ({ width: 1920, height: 1080 }),
        mouse: {
            move: async () => undefined,
            click: async (_x: number, _y: number, opts?: { delay?: number }) => {
                clickDelays.push(opts?.delay ?? -1);
            },
        },
        evaluate: async () => 0,
    };
}

/** Locator finto con un box stabile: il punto di click varia solo per la dispersione gaussiana. */
const locatorFinto = {
    scrollIntoViewIfNeeded: async () => undefined,
    boundingBox: async () => ({ x: 100, y: 200, width: 160, height: 40 }),
};

// ─── Raccolta delle sequenze dalle funzioni REALI ────────────────────────────

function sequenzaDwellTastiera(): number[] {
    seminaDaCapo();
    return Array.from({ length: N_PRIMITIVE }, () => humanKeystrokeDwellMs());
}

function sequenzaFlightTastiera(char: string): number[] {
    seminaDaCapo();
    return Array.from({ length: N_PRIMITIVE }, () => humanKeystrokeDelayMs(char));
}

async function sequenzaViewportDwell(): Promise<number[]> {
    seminaDaCapo();
    const attese: number[] = [];
    const page = paginaCheRegistra(attese, []);
    for (let i = 0; i < N_PRIMITIVE; i++) {
        await ensureViewportDwell(page as never, '.bersaglio', 650, 1400);
    }
    return attese;
}

/** Pre-click e dwell del bottone del mouse, presi dalla funzione reale del gesto. */
async function sequenzeDelGesto(): Promise<{ preClick: number[]; movimento: number[]; clickDelay: number[] }> {
    seminaDaCapo();
    const preClick: number[] = [];
    const movimento: number[] = [];
    const clickDelays: number[] = [];
    for (let i = 0; i < N_PRIMITIVE; i++) {
        const attese: number[] = [];
        const page = paginaCheRegistra(attese, clickDelays);
        updateMouseState(page as never, { x: 100, y: 100 });
        await clickCoordinatesHumanLike(page as never, 320, 480);
        // L'ULTIMA attesa e' il pre-click (`humanClick.ts:19`); quelle prima sono il percorso del
        // mouse, una per punto: si congelano separate perche' misurano cose diverse.
        preClick.push(attese[attese.length - 1]);
        movimento.push(attese.slice(0, -1).reduce((acc, v) => acc + v, 0));
    }
    return { preClick, movimento, clickDelay: clickDelays };
}

/**
 * Attesa TOTALE fra la decisione dell'AI e il click, sul path dell'invito.
 * Catena: `humanDelay(suggerito)` quando l'AI propone un ritardo (`inviteWorker.ts:478-483`), poi
 * `clickLocatorHumanLike` con `selectorForDwell` — cioe' dwell nel viewport 650-1400 e pre-click.
 * L'ordine e' verificato separatamente sul sorgente del worker (vedi il test sulla sequenza).
 */
async function sequenzaCatenaInvito(suggestedDelaySec: number | null): Promise<number[]> {
    seminaDaCapo();
    const totali: number[] = [];
    for (let i = 0; i < N_CATENA; i++) {
        const attese: number[] = [];
        const page = paginaCheRegistra(attese, []);
        if (suggestedDelaySec !== null && suggestedDelaySec > 0) {
            await humanDelay(page as never, suggestedDelaySec * 1000, (suggestedDelaySec + 2) * 1000);
        }
        await clickLocatorHumanLike(page as never, locatorFinto as never, { selectorForDwell: '.connect' });
        totali.push(attese.reduce((acc, v) => acc + v, 0));
    }
    return totali;
}

// ─── Costanti TIMING-CORE lette dal SORGENTE (anche quelle non esportate) ────

const RADICE = process.cwd();

function letteraliNumerici(file: string, nomi: string[]): Record<string, number> {
    const sorgente = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(RADICE, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const espressioni: Record<string, string> = {};
    const visita = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && nomi.includes(node.name.text)) {
            espressioni[node.name.text] = node.initializer?.getText(sorgente) ?? '';
        }
        ts.forEachChild(node, visita);
    };
    visita(sorgente);

    // Due passate: `DWELL_MIN_RATIO = 62 / DWELL_MEDIANA_BASE` cita una costante letta prima.
    const trovati: Record<string, number> = {};
    for (const passata of [0, 1]) {
        for (const [nome, testo] of Object.entries(espressioni)) {
            if (nome in trovati) continue;
            const risolto = testo.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) =>
                id in trovati ? String(trovati[id]) : id,
            );
            if (!/^[\d\s+\-*/.()]+$/.test(risolto)) continue;
            trovati[nome] = Number(new Function(`return (${risolto});`)());
        }
        if (passata === 0 && Object.keys(trovati).length === nomi.length) break;
    }
    return trovati;
}

/** Numeri scritti a mano dentro il gesto: pre-click e dwell del bottone (`humanClick.ts:19-21`). */
function numeriDelGesto(): number[] {
    const testo = fs.readFileSync(path.join(RADICE, 'src/browser/humanClick.ts'), 'utf8');
    const preClick = testo.match(/waitForTimeout\((\d+) \+ Math\.floor\(Math\.random\(\) \* Math\.random\(\) \* (\d+)\)\)/);
    const clickDelay = testo.match(/delay: (\d+) \+ Math\.floor\(Math\.random\(\) \* (\d+)\)/);
    if (!preClick || !clickDelay) return [];
    return [Number(preClick[1]), Number(preClick[2]), Number(clickDelay[1]), Number(clickDelay[2])];
}

// ─── BASELINE congelata ──────────────────────────────────────────────────────
const BASELINE = {
    costanti: {
        'keystrokeTiming.DWELL_SIGMA': 0.22,
        'keystrokeTiming.DWELL_MEDIANA_BASE': 85,
        'keystrokeTiming.DWELL_MIN_RATIO': 62 / 85,
        'keystrokeTiming.DWELL_MAX_RATIO': 118 / 85,
        'keystrokeTiming.DWELL_FLOOR_MS': 55,
        'mouseMovement.MOUSE_MOVE_TIMEOUT_MS_default': 8000,
        'humanClick.gesto': [40, 220, 40, 70],
        'keystrokeTiming.finestraDwellDellAccount': [85.259, 62.189, 118.36],
        'keystrokeTiming.fattoreLunghezzaTesto': [0.85, 1, 1.15, 1.3],
    },
    sequenze: {} as Record<string, { hash: string; primi: number[]; mean: number; p50: number; p95: number }>,
};

// I valori delle sequenze si generano al primo run (C63_PRINT=1) e si incollano qui.
BASELINE.sequenze = {
    dwell_tastiera: {
        hash: '3ad9b1806288f97c3beab9a501cc5677d3bb7cc5bda6aa0c239dc8ad281bfda3',
        primi: [94, 113, 79, 105, 104, 96, 98, 94, 95, 93, 75, 81, 103, 84, 80, 108, 98, 84, 74, 106],
        mean: 86.72,
        p50: 86,
        p95: 112,
    },
    flight_tastiera_lettera: {
        hash: 'c9dbd6b7f5f2b0d30fc68a02954b05f48b4291930a8ef4b27fe6979cf78c5b81',
        primi: [114, 162, 83, 142, 138, 120, 123, 115, 117, 112, 74, 85, 136, 93, 84, 148, 124, 93, 72, 143],
        mean: 103.05,
        p50: 95,
        p95: 181,
    },
    flight_tastiera_spazio: {
        hash: '0bf38b231dd09cc7c2b04ad7411afcf339fc231a2023c9c3517887d9f92e3030',
        primi: [240, 342, 175, 298, 292, 252, 259, 243, 246, 235, 156, 180, 287, 195, 177, 312, 260, 197, 152, 301],
        mean: 215.39,
        p50: 200,
        p95: 382,
    },
    viewport_dwell: {
        hash: 'd12f95795ad581a6e98816d47c21c8d3418772af64b1a019c58e6890f7ee3ebe',
        primi: [1265, 747, 981, 1391, 1123, 1171, 1114, 679, 1148, 1385, 721, 1243, 757, 1250, 1185, 766, 733, 1240, 1234, 768],
        mean: 1024.8,
        p50: 1026,
        p95: 1364,
    },
    pre_click: {
        hash: '2d0ece9feb62263e529a640f9c88adedd636e9f5be21c948cff28c4d26981aa9',
        primi: [75, 50, 100, 254, 178, 59, 58, 41, 106, 55, 58, 139, 50, 110, 74, 64, 49, 118, 114, 107],
        mean: 94.53,
        p50: 80,
        p95: 191,
    },
    percorso_mouse: {
        hash: 'a6439f18c7500c881d3b9ffdca736e58ae8be9a3a99cf42608796bb1bfbdc01d',
        primi: [758, 826, 683, 710, 494, 578, 499, 455, 728, 586, 749, 567, 507, 675, 683, 761, 488, 702, 693, 525],
        mean: 597.08,
        p50: 574,
        p95: 777,
    },
    mouse_click_delay: {
        hash: '3c88cc8c593e519fc40e36dc9d04fdc9f0d59bd06ddcfed31e4f15d1a7ff3ebd',
        primi: [58, 65, 85, 53, 70, 67, 95, 41, 96, 94, 85, 93, 76, 48, 65, 79, 107, 68, 107, 63],
        mean: 74.63,
        p50: 75,
        p95: 106,
    },
    catena_invito_senza_suggerimento: {
        hash: '15f42781663f62c6c40748895ffd84bfeca00044017d08d64303532f9f6d1fb3',
        primi: [2135, 1562, 1735, 2162, 1629, 1029, 1958, 1640, 2000, 2315, 2268, 2126, 1766, 1281, 1892, 1932, 2193, 1879, 1947, 1483],
        mean: 1839.83,
        p50: 1837,
        p95: 2290,
    },
    catena_invito_con_suggerimento: {
        hash: '6a056852e0da169354a07aec3a7a40e1588c93b608ee6ccde76dc87d4350a950',
        primi: [8180, 8622, 7139, 8698, 7792, 17125, 15892, 8938, 7882, 7694, 8933, 7132, 15344, 7075, 7747, 8120, 8316, 8823, 6556, 7235],
        mean: 8967.06,
        p50: 8120,
        p95: 15758,
    },
};

let stampa: Record<string, unknown> = {};

let accountIdPrecedente: string | undefined;

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ORA_FISSA));
    accountIdPrecedente = process.env.ACCOUNT_ID;
    process.env.ACCOUNT_ID = ACCOUNT_BASELINE;
    vi.spyOn(Math, 'random').mockImplementation(() => rnd());
    seminaDaCapo();
});

afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // B8 della review: l'env va restituita com'era, altrimenti il seme dell'account resta appiccicato
    // ai test che girano dopo nello stesso processo.
    if (accountIdPrecedente === undefined) delete process.env.ACCOUNT_ID;
    else process.env.ACCOUNT_ID = accountIdPrecedente;
    if (process.env.C63_PRINT) {
        console.log('\n=== BASELINE C63 (incolla in BASELINE.sequenze) ===\n' + JSON.stringify(stampa, null, 4));
    }
});

beforeEach(() => {
    seminaDaCapo();
});

describe('C63 — baseline dei timing congelata prima di toccare il gesto', () => {
    it('costanti TIMING-CORE: uguaglianza esatta, nessuna tolleranza', () => {
        const dwell = letteraliNumerici('src/browser/human/keystrokeTiming.ts', [
            'DWELL_SIGMA',
            'DWELL_MEDIANA_BASE',
            'DWELL_MIN_RATIO',
            'DWELL_MAX_RATIO',
            'DWELL_FLOOR_MS',
        ]);
        expect(dwell.DWELL_SIGMA).toBe(BASELINE.costanti['keystrokeTiming.DWELL_SIGMA']);
        expect(dwell.DWELL_MEDIANA_BASE).toBe(BASELINE.costanti['keystrokeTiming.DWELL_MEDIANA_BASE']);
        expect(dwell.DWELL_MIN_RATIO).toBe(BASELINE.costanti['keystrokeTiming.DWELL_MIN_RATIO']);
        expect(dwell.DWELL_MAX_RATIO).toBe(BASELINE.costanti['keystrokeTiming.DWELL_MAX_RATIO']);
        expect(dwell.DWELL_FLOOR_MS).toBe(BASELINE.costanti['keystrokeTiming.DWELL_FLOOR_MS']);

        expect(numeriDelGesto()).toEqual(BASELINE.costanti['humanClick.gesto']);

        const finestra = finestraDwellDellAccount();
        expect([
            Math.round(finestra.medianaMs * 1000) / 1000,
            Math.round(finestra.minMs * 1000) / 1000,
            Math.round(finestra.maxMs * 1000) / 1000,
        ]).toEqual(BASELINE.costanti['keystrokeTiming.finestraDwellDellAccount']);

        expect([
            fattoreLunghezzaTesto('x'.repeat(10)),
            fattoreLunghezzaTesto('x'.repeat(100)),
            fattoreLunghezzaTesto('x'.repeat(300)),
            fattoreLunghezzaTesto('x'.repeat(500)),
        ]).toEqual(BASELINE.costanti['keystrokeTiming.fattoreLunghezzaTesto']);
    });

    it('sequenze a seme fisso: hash identico, primi valori identici', async () => {
        const misurate: Record<string, number[]> = {
            dwell_tastiera: sequenzaDwellTastiera(),
            flight_tastiera_lettera: sequenzaFlightTastiera('a'),
            flight_tastiera_spazio: sequenzaFlightTastiera(' '),
            viewport_dwell: await sequenzaViewportDwell(),
        };
        const gesto = await sequenzeDelGesto();
        misurate.pre_click = gesto.preClick;
        misurate.percorso_mouse = gesto.movimento;
        misurate.mouse_click_delay = gesto.clickDelay;
        misurate.catena_invito_senza_suggerimento = await sequenzaCatenaInvito(null);
        misurate.catena_invito_con_suggerimento = await sequenzaCatenaInvito(5);

        stampa = Object.fromEntries(
            Object.entries(misurate).map(([nome, seq]) => [
                nome,
                { hash: hash(seq), primi: seq.slice(0, VALORI_IN_CHIARO), ...statistiche(seq) },
            ]),
        );

        for (const [nome, sequenza] of Object.entries(misurate)) {
            const attesa = BASELINE.sequenze[nome];
            expect(attesa, `sequenza «${nome}» non ancora congelata — rilancia con C63_PRINT=1`).toBeDefined();
            expect(sequenza.length, `lunghezza di «${nome}»`).toBe(nome.startsWith('catena') ? N_CATENA : N_PRIMITIVE);
            expect(hash(sequenza), `hash di «${nome}»`).toBe(attesa.hash);
            expect(sequenza.slice(0, VALORI_IN_CHIARO), `primi valori di «${nome}»`).toEqual(attesa.primi);
        }
    });

    it('la sorgente di entropia del timing resta il CSPRNG, non Math.random', () => {
        // Il mock sopra semina `crypto.randomInt` per poter congelare la forma. L'invariante
        // opposto va protetto lo stesso: se un domani `utils/random` passasse a `Math.random`,
        // l'istogramma resterebbe simile ma i tempi diventerebbero predicibili da un osservatore.
        const file = 'src/utils/random.ts';
        const sorgente = ts.createSourceFile(
            file,
            fs.readFileSync(path.join(RADICE, file), 'utf8'),
            ts.ScriptTarget.Latest,
            true,
        );
        // AST, non testo: in quel file `Math.random()` compare in un COMMENTO che spiega perche'
        // NON si usa. Una regex lo pescherebbe e la sentinella direbbe il falso.
        const usiDiMathRandom: number[] = [];
        const visita = (node: ts.Node): void => {
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                node.expression.expression.text === 'Math' &&
                node.expression.name.text === 'random'
            ) {
                usiDiMathRandom.push(sorgente.getLineAndCharacterOfPosition(node.getStart(sorgente)).line + 1);
            }
            ts.forEachChild(node, visita);
        };
        visita(sorgente);
        expect(usiDiMathRandom).toEqual([]);
        expect(sorgente.text).toContain("from 'crypto'");
    });

    it('le attese fra la decisione AI e il click sono quelle congelate, in quest ordine e con questi parametri', () => {
        // La catena misurata sopra e' la parte deterministica; qui si congela la LISTA delle attese
        // che il worker mette fra l'osservazione e il gesto, parametri inclusi. Aggiungerne una,
        // toglierla o riordinarla fa fallire il test: e' il buco che la sola misura non copre.
        const testo = fs.readFileSync(path.join(RADICE, 'src/workers/inviteWorker.ts'), 'utf8');
        const dopoDecisione = testo.slice(testo.indexOf('suggestedDelaySec'));
        const attese = [...dopoDecisione.matchAll(/humanDelay\(([^;]*?)\);/gs)].map((m) =>
            m[1].replace(/\s+/g, ' ').replace('context.session.page,', '').replace('context.session.page', '').trim(),
        );
        expect(attese).toEqual([
            'aiDecision.suggestedDelaySec * 1000, (aiDecision.suggestedDelaySec + 2) * 1000,',
            '2000, 4000',
            '900, 1800',
            '500, 1500',
            '900, 1800',
            '500, 1000',
            '2000, 5000',
        ]);
    });
});
