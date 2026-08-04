import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { humanType } from '../browser/human/humanTyping';

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

    it('GEMELLO TRACCIATO: il ramo VisionSolver ha ancora il floor a 40ms', () => {
        // Trovato da questo stesso test mentre copriva il ramo normale. Stesso difetto — delay
        // uniforme, floor 40ms cioè dentro la zona-bot — ma NON lo stesso fix: lì si digita con
        // page.keyboard senza un selector, quindi delegare a humanType richiede prima di estrarne la
        // formula di timing, che è marcata TIMING-CORE e va toccata con la sua prova di invarianza.
        // Il conteggio è bloccato a 2 perché il residuo resti visibile invece di sembrare finito.
        const ramoVision = src.slice(src.indexOf('Layer Z Extremo'));
        const sottoSoglia = ramoVision.match(/delay: Math\.floor\(Math\.random\(\) \* \d+\) \+ 40/g) ?? [];
        expect(sottoSoglia).toHaveLength(2);
    });
});
