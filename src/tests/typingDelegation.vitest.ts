import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { humanKeystrokeDelayMs, humanType } from '../browser/human/humanTyping';

/**
 * `typeWithFallback` riscriveva la digitazione invece di delegarla, e la sua copia era peggiore
 * dell'originale su tre punti misurabili: delay UNIFORME (istogramma piatto) contro log-normale,
 * floor a 40ms — sotto la soglia dei 50ms indicata come zona-bot dalle keystroke dynamics — contro
 * 55/80ms, e un solo stile di correzione del typo contro quattro. Il timing sta in un posto solo.
 */

function sorgente(relPath: string): string {
    return readFileSync(join(__dirname, '..', ...relPath.split('/')), 'utf8');
}

/** Page finta: registra le chiamate senza toccare un browser. */
function pageFinta() {
    const chiamate: string[] = [];
    const element = {
        click: vi.fn(async () => {
            chiamate.push('click');
        }),
        pressSequentially: vi.fn(async () => {
            chiamate.push('type');
        }),
        press: vi.fn(async () => {
            chiamate.push('press');
        }),
    };
    const page = {
        locator: () => ({ first: () => element }),
        waitForTimeout: vi.fn(async () => undefined),
        keyboard: { down: vi.fn(async () => undefined), up: vi.fn(async () => undefined) },
        mouse: { move: vi.fn(async () => undefined) },
    };
    return { page, element, chiamate };
}

describe('humanType — opzione per non ri-cliccare il campo', () => {
    it('per default clicca, come hanno sempre fatto i chiamanti esistenti', async () => {
        const { page, element } = pageFinta();
        await humanType(page as never, '#campo', 'ab');
        expect(element.click).toHaveBeenCalledTimes(1);
    });

    it('con skipInitialClick non clicca, ma digita comunque', async () => {
        const { page, element, chiamate } = pageFinta();
        await humanType(page as never, '#campo', 'ab', { skipInitialClick: true });
        expect(element.click).not.toHaveBeenCalled();
        expect(chiamate.filter((c) => c === 'type').length).toBeGreaterThan(0);
    });
});

describe('typeWithFallback delega invece di riscrivere', () => {
    const src = sorgente('browser/uiFallback.ts');

    it('chiama humanType saltando il click, avendo già cliccato in modo umano', () => {
        expect(src).toContain("humanType(page, playwrightSel, text, { skipInitialClick: true })");
    });

    it('non contiene più il ciclo di digitazione con delay uniforme', () => {
        // Era: pressSequentially(..., { delay: Math.floor(Math.random() * 150) + 40 })
        expect(src).not.toMatch(/pressSequentially\([^)]*Math\.random\(\) \* 150/);
        expect(src).not.toContain('determineNextKeystroke');
    });

    it('il ramo CSS/XPath non contiene più keystroke sotto la soglia dei 50ms', () => {
        const ramoNormale = src.slice(0, src.indexOf('Layer Z Extremo'));
        expect(ramoNormale).not.toMatch(/delay: Math\.floor\(Math\.random\(\) \* \d+\) \+ 40/);
    });

    it('anche il ramo VisionSolver usa ora la cadenza condivisa', () => {
        // Era il gemello, trovato da questo stesso test: stesso difetto ma fix diverso, perché lì si
        // scrive su page.keyboard senza un locator. Risolto estraendo la formula, non duplicandola.
        const ramoVision = src.slice(src.indexOf('Layer Z Extremo'));
        expect(ramoVision).not.toMatch(/delay: Math\.floor\(Math\.random\(\) \* \d+\) \+ 40/);
        expect(ramoVision).toContain('humanKeystrokeDelayMs(');
    });

    it('nessun keystroke sotto la soglia dei 50ms in tutto il file', () => {
        expect(src).not.toMatch(/delay: Math\.floor\(Math\.random\(\) \* \d+\) \+ 40/);
    });
});

describe('humanKeystrokeDelayMs — invarianza del TIMING-CORE dopo l estrazione', () => {
    it('il floor per i caratteri regge: mai sotto 55ms', () => {
        for (let i = 0; i < 3000; i++) {
            expect(humanKeystrokeDelayMs('a')).toBeGreaterThanOrEqual(55);
        }
    });

    it('il floor per spazi e punteggiatura regge: mai sotto 80ms', () => {
        for (const char of [' ', '.', ',', '!', '?', '-']) {
            for (let i = 0; i < 400; i++) {
                expect(humanKeystrokeDelayMs(char)).toBeGreaterThanOrEqual(80);
            }
        }
    });

    it('il floor è applicato DOPO i moltiplicatori, che è il punto dell originale', () => {
        // Il commento del codice segnala il caso: lengthSlowFactor * wordMultiplier puo' scendere a
        // 0.595x e, applicato dopo il clamp, bypassava il floor portando i keystroke sotto i 28ms.
        for (let i = 0; i < 3000; i++) {
            expect(humanKeystrokeDelayMs('a', 0.85, 0.7)).toBeGreaterThanOrEqual(55);
        }
    });

    it('resta dentro i clamp della distribuzione log-normale', () => {
        for (let i = 0; i < 2000; i++) {
            expect(humanKeystrokeDelayMs('a')).toBeLessThanOrEqual(320);
            expect(humanKeystrokeDelayMs(' ')).toBeLessThanOrEqual(650);
        }
    });

    it('la distribuzione è asimmetrica a destra, non uniforme', () => {
        // È la proprietà per cui era stata scelta: una uniforme darebbe media ≈ mediana.
        const campioni = Array.from({ length: 6000 }, () => humanKeystrokeDelayMs('a')).sort((a, b) => a - b);
        const mediana = campioni[Math.floor(campioni.length / 2)];
        const media = campioni.reduce((s, v) => s + v, 0) / campioni.length;
        expect(media).toBeGreaterThan(mediana);
    });

    it('humanType non ricalcola la formula al suo interno', () => {
        const srcTyping = sorgente('browser/human/humanTyping.ts');
        const corpoLoop = srcTyping.slice(srcTyping.indexOf('for (let i = 0; i < text.length'));
        expect(corpoLoop).toContain('humanKeystrokeDelayMs(typedChar, lengthSlowFactor, currentWordMultiplier)');
        expect(corpoLoop).not.toContain('const keystrokeFloorMs');
    });
});
