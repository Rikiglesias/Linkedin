import { describe, expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';

// Regressione del "bridge morto" (audit 2026-08-04).
//
// `src/browser.ts` (file) OSCURA `src/browser/` (directory) nella risoluzione dei moduli:
// ogni `from '../browser'` prende il file, quindi il barrel `src/browser/index.ts` non
// veniva importato da nessuno e le sue registrazioni non giravano MAI in esercizio.
// Effetto silenzioso: callDismissOverlays tornava sempre 0 (overlay LinkedIn mai chiusi
// da blockUserInput) e callMouseMove era un no-op (click di dismiss senza movimento del
// mouse = firma anti-ban). Nessun errore, nessun log: il difetto era invisibile.
//
// Questi test falliscono se qualcuno rimette le registrazioni nel barrel o le toglie.

import '../browser';
import { callDismissOverlays, callMouseMove, callInteractWithFeed } from '../browser/overlayBridge';

/**
 * Page finta che registra ogni accesso a una property.
 * Bridge NON registrato → la funzione esce subito e la page non viene mai toccata.
 * Bridge registrato → la funzione reale accede almeno a una property (isClosed, mouse, ...).
 */
function spyPage(): { page: unknown; touched: string[] } {
    const touched: string[] = [];
    const target = {
        isClosed: () => true,
        mouse: { move: async () => undefined },
        waitForTimeout: async () => undefined,
        locator: () => ({ count: async () => 0 }),
        evaluate: async () => undefined,
        keyboard: { press: async () => undefined },
    };
    const page = new Proxy(target, {
        get(obj, prop) {
            touched.push(String(prop));
            return Reflect.get(obj, prop);
        },
    });
    return { page, touched };
}

describe('registrazione dei bridge sull entry point reale (src/browser.ts)', () => {
    test('callDismissOverlays delega a dismissKnownOverlays', async () => {
        const { page, touched } = spyPage();
        await callDismissOverlays(page as never);
        expect(touched).toContain('isClosed');
    });

    test('callMouseMove delega a humanMouseMoveToCoords', async () => {
        const { page, touched } = spyPage();
        await callMouseMove(page as never, 10, 10).catch(() => undefined);
        expect(touched.length).toBeGreaterThan(0);
    });

    test('callInteractWithFeed e registrato (probability 1 forza il percorso reale)', async () => {
        const { page, touched } = spyPage();
        await callInteractWithFeed(page as never, 1).catch(() => undefined);
        expect(touched.length).toBeGreaterThan(0);
    });

    test('le registrazioni stanno in src/browser.ts, non nel barrel oscurato', () => {
        const entry = fs.readFileSync(path.join(__dirname, '..', 'browser.ts'), 'utf8');
        expect(entry).toMatch(/registerDismissOverlaysFn\(/);
        expect(entry).toMatch(/registerMouseMoveFn\(/);
        expect(entry).toMatch(/registerInteractWithFeedFn\(/);
    });

    /**
     * 🔴 L'invariante che mancava, e che ha permesso al difetto di rientrare.
     *
     * Il test sopra verifica DOVE stanno le registrazioni. Non verifica che il barrel resti fuori
     * dai percorsi di caricamento — e infatti `linkedinProfileScraper.ts` aveva ripreso a importare
     * `./index` (commit di lint `0269a87`), rendendo il barrel vivo e le sue tre registrazioni un
     * SECONDO punto di verità. Nessun sintomo: registrare due volte le stesse funzioni è
     * idempotente. Ma il commento di `browser.ts:42` che motiva l'intero design («il barrel non è
     * importato da nessuno») era diventato falso, e nulla poteva segnalarlo.
     *
     * Perché è anti-ban e non stile: se un percorso caricasse un modulo di `src/browser/**` senza
     * passare da `src/browser.ts`, l'unica registrazione superstite sarebbe quella del barrel;
     * toglierla lascerebbe `callMouseMove` a no-op, cioè click di dismiss senza movimento del
     * mouse — la firma che il fix del 2026-08-04 aveva eliminato.
     */
    test('nessun modulo di src/browser/** importa il barrel ./index', () => {
        const dir = path.join(__dirname, '..', 'browser');
        const colpevoli: string[] = [];

        const cammina = (corrente: string): void => {
            for (const voce of fs.readdirSync(corrente, { withFileTypes: true })) {
                const completo = path.join(corrente, voce.name);
                if (voce.isDirectory()) {
                    cammina(completo);
                    continue;
                }
                if (!voce.name.endsWith('.ts') || voce.name === 'index.ts') continue;
                fs.readFileSync(completo, 'utf8')
                    .split('\n')
                    .forEach((riga, i) => {
                        // Solo import reali: le righe di commento citano il barrel di proposito.
                        const codice = riga.replace(/\/\/.*$/, '');
                        if (/from\s+'\.\/index'|from\s+"\.\/index"|import\s*\(\s*'\.\/index'/.test(codice)) {
                            colpevoli.push(`${path.relative(dir, completo).replace(/\\/g, '/')}:${i + 1}`);
                        }
                    });
            }
        };
        cammina(dir);

        expect(colpevoli).toEqual([]);
    });
});
