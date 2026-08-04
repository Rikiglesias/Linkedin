import { describe, it, expect, vi } from 'vitest';

// `humanDelay` mette in pausa con tempi reali: qui interessa quale step blocca il canary,
// non quanto attende. È l'unica cosa finta del test — la pagina è un doppio, ma il piano
// degli step e la logica di verdetto sono quelli veri.
vi.mock('../browser/humanBehavior', () => ({
    humanDelay: vi.fn(async () => {}),
}));

import { runSelectorCanaryDetailed } from '../browser/selectorCanary';

/** Testo di una pagina LinkedIn davvero renderizzata (quantità, non contenuto). */
const PAGINA_PIENA = 'contenuto renderizzato '.repeat(40);

interface OpzioniPaginaFinta {
    /** Frammenti di URL su cui `waitForSelector` fallisce: il selettore non c'è. */
    selettoriAssentiSu?: string[];
    /** Frammenti di URL su cui `goto` solleva: la pagina non arriva proprio (rete/proxy). */
    navigazioneFallitaSu?: string[];
    /** Frammenti di URL su cui il DOM resta vuoto: la pagina risponde ma non renderizza. */
    domVuotoSu?: string[];
    /** Frammento di URL dopo il quale la pagina redirige altrove (es. authwall). */
    redirectSu?: { da: string; a: string };
}

/**
 * Pagina finta. Di default è una pagina LinkedIn arrivata e renderizzata: le opzioni
 * introducono UN modo di fallire per volta, così ogni test distingue una causa sola.
 */
function pageFinta(opzioni: OpzioniPaginaFinta = {}) {
    const { selettoriAssentiSu = [], navigazioneFallitaSu = [], domVuotoSu = [], redirectSu } = opzioni;
    let urlCorrente = '';
    const combacia = (frammenti: string[]) => frammenti.some((f) => urlCorrente.includes(f));

    return {
        goto: async (url: string) => {
            urlCorrente = url;
            if (combacia(navigazioneFallitaSu)) {
                urlCorrente = 'about:blank';
                throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
            }
            if (redirectSu && url.includes(redirectSu.da)) urlCorrente = redirectSu.a;
        },
        url: () => urlCorrente,
        textContent: async () => (combacia(domVuotoSu) ? '' : PAGINA_PIENA),
        waitForSelector: async () => {
            if (combacia(selettoriAssentiSu)) throw new Error('selector non trovato');
            return {};
        },
    };
}

describe('selectorCanary — quali superfici possono fermare il bot', () => {
    it('il feed rotto da solo NON ferma il bot', async () => {
        // Prima di questa modifica il feed era l'UNICO step obbligatorio: un suo problema
        // (tipicamente un timeout per rete o proxy lenti) apriva un incidente CRITICAL e
        // metteva in quarantena tutti gli account. È il caso reale del 2026-03-30.
        const page = pageFinta({ selettoriAssentiSu: ['/feed/'] });

        const report = await runSelectorCanaryDetailed(page as never, 'invite');

        expect(report.ok).toBe(true);
        expect(report.criticalFailed).toBe(0);
        expect(report.optionalFailed).toBe(1);
    });

    it('la superficie degli inviti rotta FERMA il bot', async () => {
        // Il caso opposto, che prima passava inosservato: se cambia il bottone «Collegati»
        // il bot continuerebbe a lavorare alla cieca. Ora è questo a fermarlo.
        const page = pageFinta({ selettoriAssentiSu: ['/search/results/people/'] });

        const report = await runSelectorCanaryDetailed(page as never, 'invite');

        expect(report.ok).toBe(false);
        expect(report.criticalFailed).toBe(1);
    });

    it('anche messaggi e rete sono superfici che fermano il bot', async () => {
        const perMessaggi = await runSelectorCanaryDetailed(
            pageFinta({ selettoriAssentiSu: ['/messaging/'] }) as never,
            'message',
        );
        expect(perMessaggi.ok).toBe(false);

        const perRete = await runSelectorCanaryDetailed(
            pageFinta({ selettoriAssentiSu: ['/mynetwork/'] }) as never,
            'check',
        );
        expect(perRete.ok).toBe(false);
    });

    it('le superfici obbligatorie hanno lo stesso tempo di attesa del feed', async () => {
        // Guardia contro una regressione precisa: erano a 6s mentre il feed sta a 10s perché
        // 4s davano falsi negativi su pagine React. Riabbassarle ora non darebbe un falso
        // negativo innocuo: fermerebbe il bot per una pagina solo lenta.
        const attese: number[] = [];
        const page = {
            goto: async () => {},
            url: () => 'https://www.linkedin.com/feed/',
            textContent: async () => PAGINA_PIENA,
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

describe('selectorCanary — «il DOM è cambiato» non è «la pagina non è arrivata»', () => {
    // Il canary dava lo stesso verdetto (`selector_not_found`) a due fatti opposti: un
    // selettore rimosso da LinkedIn (problema di piattaforma, riguarda tutti) e una pagina
    // mai caricata per rete o proxy (problema locale, passa da solo). Il secondo apriva una
    // quarantena globale permanente: è quello che è successo il 2026-03-30, quando 19 cicli
    // sono stati abortiti in ~11s l'uno — la durata esatta del timeout, non un cambio di DOM.

    it('pagina che non arriva (proxy/rete) → esito «non so», MAI colpa dei selettori', async () => {
        const page = pageFinta({ navigazioneFallitaSu: ['/search/results/people/'] });

        const report = await runSelectorCanaryDetailed(page as never, 'invite');

        expect(report.ok).toBe(false); // il ciclo si ferma comunque: senza pagina non si lavora
        expect(report.criticalFailed).toBe(0); // ...ma NON come drift di selettori
        expect(report.criticalUnknown).toBe(1);
        const inviti = report.steps.find((s) => s.id === 'invite.search_surface');
        expect(inviti?.state).toBe('unknown');
    });

    it('pagina che risponde ma resta bianca → «non so» (il DOM non è mai stato renderizzato)', async () => {
        const page = pageFinta({
            selettoriAssentiSu: ['/messaging/'],
            domVuotoSu: ['/messaging/'],
        });

        const report = await runSelectorCanaryDetailed(page as never, 'message');

        expect(report.criticalFailed).toBe(0);
        expect(report.criticalUnknown).toBe(1);
    });

    it('redirect fuori dalla pagina chiesta (authwall) → «non so» SUBITO, senza aspettare i selettori', async () => {
        // Il verdetto sarebbe stato lo stesso anche cercando i selettori, ma cercarli significa
        // tenere il browser fermo su LinkedIn per decine di secondi (fino a 3 selettori × 10 s per
        // superficie, e il guard ritenta l'intero canary) per concludere ciò che l'URL diceva già.
        let selettoriCercatiSullAuthwall = 0;
        const page = pageFinta({
            selettoriAssentiSu: ['/authwall'],
            redirectSu: { da: '/mynetwork/', a: 'https://www.linkedin.com/authwall?trk=x' },
        });
        const waitOriginale = page.waitForSelector;
        page.waitForSelector = async (...args: []) => {
            // Conta SOLO le ricerche fatte mentre siamo sull'authwall: gli altri step del piano
            // (il feed, che qui non viene redirezionato) cercano i loro selettori a ragione.
            if (page.url().includes('/authwall')) selettoriCercatiSullAuthwall += 1;
            return waitOriginale(...args);
        };

        const report = await runSelectorCanaryDetailed(page as never, 'check');

        expect(report.criticalFailed).toBe(0);
        expect(report.criticalUnknown).toBe(1);
        // Nessuna attesa sprecata sulla superficie finita sull'authwall.
        const rete = report.steps.find((s) => s.id === 'check.network_surface');
        expect(rete?.error).toContain('auth_wall');
        expect(selettoriCercatiSullAuthwall).toBe(0);
    });

    it('selettore assente su pagina ARRIVATA e piena → questo sì è drift di piattaforma', async () => {
        // Il controllo speculare: il nuovo esito «non so» non deve diventare una scusa per
        // non accorgersi mai di nulla. Pagina caricata + selettore assente resta `unsafe`.
        const page = pageFinta({ selettoriAssentiSu: ['/search/results/people/'] });

        const report = await runSelectorCanaryDetailed(page as never, 'invite');

        expect(report.criticalFailed).toBe(1);
        expect(report.criticalUnknown).toBe(0);
        const inviti = report.steps.find((s) => s.id === 'invite.search_surface');
        expect(inviti?.state).toBe('unsafe');
        expect(inviti?.error).toBe('selector_not_found');
    });
});
