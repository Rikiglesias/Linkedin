import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getStartingPoint, initializeMouseState, pageMouseState } from '../browser/human/mouseState';

/**
 * Fase 4, gruppo «movimento»: gli 8 siti in cui `page.viewportSize() ?? {default}` non serviva a
 * validare una coordinata (quello era il gruppo della Fase 1) ma a **generare** il bersaglio del
 * mouse o a **clampare** un bersaglio che veniva da altrove.
 *
 * Perche' e' un difetto anti-ban e non un'imprecisione: nella configurazione di DEFAULT
 * (`HEADLESS=false` ⇒ `launcher.ts` apre con `viewport: null`) `viewportSize()` e' SEMPRE null, quindi
 * il default vinceva sempre. Su una finestra reale 1920x1080 il codice credeva 1280x800 ⇒
 * `Math.random() * viewport.width` non produce MAI un punto nel terzo destro dello schermo, e
 * `Math.min(viewport.width - 1, x)` schiaccia su 1279 qualunque bersaglio piu' a destra.
 * Un cursore che in migliaia di sessioni non visita mai un terzo dello schermo e' una firma.
 *
 * I due degradi NON sono lo stesso:
 * - il viewport GENERA il bersaglio (qui) ⇒ dimensioni ignote = non si genera, si salta;
 * - il viewport CLAMPA un bersaglio reale (`boundingBox()`) ⇒ ignote = niente clamp, il bersaglio
 *   della pagina e' piu' affidabile di un limite inventato.
 */

const SORGENTI = ['browser/human/mouseMovement.ts', 'browser/human/mouseState.ts', 'browser/human/touchGestures.ts', 'browser/missclick.ts', 'salesnav/bulkSavePagination.ts'];

function leggiSorgente(relativo: string): string {
    return readFileSync(join(__dirname, '..', relativo), 'utf8');
}

/** Finta Page in configurazione NORMALE: viewport non dichiarato, finestra vera misurata dal DOM. */
function pageNonHeadless(width: number, height: number) {
    return {
        viewportSize: () => null,
        evaluate: async () => ({ width, height }),
    } as never;
}

/** Finta Page che non sa rispondere: pagina chiusa / context distrutto. */
function pageMuta() {
    return {
        viewportSize: () => null,
        evaluate: async () => {
            throw new Error('Execution context was destroyed');
        },
    } as never;
}

describe('guardia sul sorgente — nessun sito del movimento assume piu\' una finestra', () => {
    it('ROSSO DI CONTROLLO: i 5 file del gruppo non contengono piu\' `viewportSize() ?? {`', () => {
        // Questa asserzione era ROSSA prima del fix ed elencava esattamente i colpevoli:
        // mouseMovement:80/124/157 · mouseState:23/39 · touchGestures:42 · missclick:131 ·
        // bulkSavePagination:305. Diventa verde SOLO perche' sono stati corretti, non per riscrittura.
        // I commenti sono esclusi di proposito: descrivere il difetto vecchio ("col vecchio
        // `viewportSize() ?? {...}`") e' documentazione utile, e una guardia che un commento puo'
        // rendere rossa insegna a NON spiegare il perche' del fix — l'opposto di cio' che serve.
        const eCommento = (riga: string) => /^\s*(\/\/|\*|\/\*)/.test(riga);
        const colpevoli: string[] = [];
        for (const relativo of SORGENTI) {
            const righe = leggiSorgente(relativo).split('\n');
            righe.forEach((riga, i) => {
                if (!eCommento(riga) && /viewportSize\(\)\s*\?\?\s*\{/.test(riga)) colpevoli.push(`${relativo}:${i + 1}`);
            });
        }
        expect(colpevoli).toEqual([]);
    });

    it('la guardia NON e\' cieca: riconosce il codice colpevole e ignora solo i commenti', () => {
        // Senza questo, escludere i commenti potrebbe aver reso verde una guardia che non trova piu'
        // nulla — "piu' pulito ma non protegge" e' un fallimento, non un fix.
        const eCommento = (riga: string) => /^\s*(\/\/|\*|\/\*)/.test(riga);
        const colpevole = (riga: string) => !eCommento(riga) && /viewportSize\(\)\s*\?\?\s*\{/.test(riga);

        expect(colpevole('    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };')).toBe(true);
        expect(colpevole('const v = page.viewportSize() ?? {width:390,height:844};')).toBe(true);
        expect(colpevole(' * Col vecchio `viewportSize() ?? { width: 1280 }` il default vinceva.')).toBe(false);
        expect(colpevole('    // viewportSize() ?? { ... } era il pattern rotto')).toBe(false);
        expect(colpevole('    const viewport = await dimensioniFinestra(page);')).toBe(false);
    });

    it('ogni file del gruppo passa dall\'unita\' condivisa, non da una copia locale', () => {
        for (const relativo of SORGENTI) {
            expect(leggiSorgente(relativo), relativo).toMatch(/dimensioniFinestra/);
        }
    });

    it('il falso positivo del grep resta intatto: il viewport di CALIBRAZIONE non e\' un default', () => {
        // `VISION_FALLBACK_VIEWPORT` dice "per quale finestra furono misurate le coordinate fisse".
        // Sostituirlo con la misura reale distruggerebbe la guardia che la Fase 1 ci ha messo sopra:
        // il confronto diventerebbe "la finestra e' uguale a se stessa" ⇒ sempre compatibile.
        const src = leggiSorgente('salesnav/visionNavigator.ts');
        expect(src).toMatch(/const VISION_FALLBACK_VIEWPORT = \{ width: 1280, height: 800 \}/);
        expect(src).toMatch(/fallbackViewportCompatibile/);
    });
});

describe('getStartingPoint — il bordo da cui entra il mouse e\' quello VERO', () => {
    it('ROSSO DI CONTROLLO: su finestra 1920x1080 i punti d\'ingresso superano 1280', async () => {
        const page = pageNonHeadless(1920, 1080);
        const xs: number[] = [];
        for (let i = 0; i < 400; i++) {
            pageMouseState.delete(page);
            const p = await getStartingPoint(page);
            expect(p).not.toBeNull();
            if (p) xs.push(p.x);
        }

        // Col vecchio default 1280x800 questo era IMPOSSIBILE: nessun punto d'ingresso poteva
        // cadere oltre 1280, cioe' il mouse non entrava mai dal terzo destro dello schermo.
        expect(Math.max(...xs)).toBeGreaterThan(1280);
        // E il bordo destro dichiarato e' quello reale, non 1280.
        expect(xs.some((x) => x > 1900)).toBe(true);
    });

    it('dimensioni ignote ⇒ null: non si inventa un punto di partenza', async () => {
        expect(await getStartingPoint(pageMuta())).toBeNull();
    });

    it('se la posizione e\' gia\' nota non misura nulla e la restituisce', async () => {
        const page = pageNonHeadless(1920, 1080);
        pageMouseState.set(page, { x: 42, y: 24 });
        expect(await getStartingPoint(page)).toEqual({ x: 42, y: 24 });
    });
});

describe('initializeMouseState — nessuno stato inventato', () => {
    it('su finestra reale inizializza dentro la finestra reale', async () => {
        const page = pageNonHeadless(2560, 1440);
        await initializeMouseState(page);
        const p = pageMouseState.get(page);
        expect(p).toBeDefined();
        if (!p) return;
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(2560);
        expect(p.y).toBeLessThan(1440);
    });

    it('ROSSO DI CONTROLLO: su 2560px la x iniziale supera il massimo raggiungibile con 1280', async () => {
        // initializeMouseState usa width * (0.3 + random*0.4) ⇒ col vecchio default 1280 il tetto
        // ASSOLUTO era 896 px, irraggiungibile oltre. Con la finestra vera il minimo e' gia' 768 e
        // il tetto 1792: superare 1280 e' impossibile prima del fix e quasi certo dopo.
        const page = pageNonHeadless(2560, 1440);
        const xs: number[] = [];
        for (let i = 0; i < 200; i++) {
            pageMouseState.delete(page);
            await initializeMouseState(page);
            const p = pageMouseState.get(page);
            if (p) xs.push(p.x);
        }
        expect(Math.max(...xs)).toBeGreaterThan(1280);
    });

    it('dimensioni ignote ⇒ non registra nessuno stato (chi chiama restera\' senza punto)', async () => {
        const page = pageMuta();
        await initializeMouseState(page);
        expect(pageMouseState.has(page)).toBe(false);
    });
});
