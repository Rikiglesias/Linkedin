import { describe, it, expect, vi } from 'vitest';

// `humanDelay` mette in pausa con tempi reali: qui interessa quale step blocca il canary,
// non quanto attende. È l'unica cosa finta del test — la pagina è un doppio, ma il piano
// degli step e la logica di verdetto sono quelli veri.
vi.mock('../browser/humanBehavior', () => ({
    humanDelay: vi.fn(async () => {}),
}));

import { runSelectorCanaryDetailed } from '../browser/selectorCanary';

/**
 * Pagina finta: `urlFallite` elenca i frammenti di URL su cui `waitForSelector` deve fallire,
 * simulando un selettore che non c'è (o una pagina che non arriva).
 */
function pageFinta(urlFallite: string[]) {
    let urlCorrente = '';
    return {
        goto: async (url: string) => {
            urlCorrente = url;
        },
        waitForSelector: async () => {
            if (urlFallite.some((frammento) => urlCorrente.includes(frammento))) {
                throw new Error('selector non trovato');
            }
            return {};
        },
    };
}

describe('selectorCanary — quali superfici possono fermare il bot', () => {
    it('il feed rotto da solo NON ferma il bot', async () => {
        // Prima di questa modifica il feed era l'UNICO step obbligatorio: un suo problema
        // (tipicamente un timeout per rete o proxy lenti) apriva un incidente CRITICAL e
        // metteva in quarantena tutti gli account. È il caso reale del 2026-03-30.
        const page = pageFinta(['/feed/']);

        const report = await runSelectorCanaryDetailed(page as never, 'invite');

        expect(report.ok).toBe(true);
        expect(report.criticalFailed).toBe(0);
        expect(report.optionalFailed).toBe(1);
    });

    it('la superficie degli inviti rotta FERMA il bot', async () => {
        // Il caso opposto, che prima passava inosservato: se cambia il bottone «Collegati»
        // il bot continuerebbe a lavorare alla cieca. Ora è questo a fermarlo.
        const page = pageFinta(['/search/results/people/']);

        const report = await runSelectorCanaryDetailed(page as never, 'invite');

        expect(report.ok).toBe(false);
        expect(report.criticalFailed).toBe(1);
    });

    it('anche messaggi e rete sono superfici che fermano il bot', async () => {
        const perMessaggi = await runSelectorCanaryDetailed(pageFinta(['/messaging/']) as never, 'message');
        expect(perMessaggi.ok).toBe(false);

        const perRete = await runSelectorCanaryDetailed(pageFinta(['/mynetwork/']) as never, 'check');
        expect(perRete.ok).toBe(false);
    });

    it('le superfici obbligatorie hanno lo stesso tempo di attesa del feed', async () => {
        // Guardia contro una regressione precisa: erano a 6s mentre il feed sta a 10s perché
        // 4s davano falsi negativi su pagine React. Riabbassarle ora non darebbe un falso
        // negativo innocuo: fermerebbe il bot per una pagina solo lenta.
        const attese: number[] = [];
        const page = {
            goto: async () => {},
            waitForSelector: async (_sel: string, opzioni: { timeout: number }) => {
                attese.push(opzioni.timeout);
                return {};
            },
        };

        await runSelectorCanaryDetailed(page as never, 'all');

        expect(attese.length).toBeGreaterThan(0);
        expect(Math.min(...attese)).toBeGreaterThanOrEqual(10000);
    });
});
