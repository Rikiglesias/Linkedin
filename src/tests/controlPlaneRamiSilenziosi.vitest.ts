import { describe, it, expect } from 'vitest';
import { RAMI_SYNC, eseguiRami, ramiFallitiDaEsiti } from '../cloud/controlPlaneSync';

/**
 * F-CB.10 / D3 — `Promise.allSettled` scartava i `rejected` senza ispezionarli: i tre rami del
 * control-plane sync (accounts down, leads down, salesnav up) potevano fallire a ogni giro in
 * silenzio totale. `syncSalesNavUp` ha un try/catch proprio, gli altri due NO.
 *
 * Il predicato è estratto PURO di proposito: testare `runControlPlaneSync` end-to-end richiederebbe
 * di mockare config + supabase + db + runtime flags (lezione do-not-redo della chat #19 su
 * `runPreflightEnvCommand`). Qui si prova la regola; il wiring si legge a `controlPlaneSync.ts`.
 */
describe('ramiFallitiDaEsiti — nessun ramo del control-plane sync fallisce in silenzio', () => {
    it('tutti i rami riusciti → nessun fallimento da loggare', () => {
        const esiti: PromiseSettledResult<unknown>[] = [
            { status: 'fulfilled', value: undefined },
            { status: 'fulfilled', value: undefined },
            { status: 'fulfilled', value: undefined },
        ];
        expect(ramiFallitiDaEsiti(['accounts_down', 'leads_down', 'salesnav_up'], esiti)).toEqual([]);
    });

    it('un ramo rigettato → viene riportato COL SUO NOME, non come errore generico', () => {
        const esiti: PromiseSettledResult<unknown>[] = [
            { status: 'rejected', reason: new Error('SQLITE_ERROR: no such table: accounts') },
            { status: 'fulfilled', value: undefined },
            { status: 'fulfilled', value: undefined },
        ];
        const falliti = ramiFallitiDaEsiti(['accounts_down', 'leads_down', 'salesnav_up'], esiti);
        expect(falliti).toHaveLength(1);
        expect(falliti[0].ramo).toBe('accounts_down');
        expect(falliti[0].errore).toContain('no such table: accounts');
    });

    it('più rami rigettati → li riporta TUTTI (non si ferma al primo)', () => {
        const esiti: PromiseSettledResult<unknown>[] = [
            { status: 'rejected', reason: new Error('boom-1') },
            { status: 'rejected', reason: new Error('boom-2') },
            { status: 'fulfilled', value: undefined },
        ];
        const falliti = ramiFallitiDaEsiti(['accounts_down', 'leads_down', 'salesnav_up'], esiti);
        expect(falliti.map((f) => f.ramo)).toEqual(['accounts_down', 'leads_down']);
    });

    it('reason che NON è un Error → il messaggio resta valorizzato (mai stringa vuota)', () => {
        const esiti: PromiseSettledResult<unknown>[] = [{ status: 'rejected', reason: 'stringa nuda' }];
        const falliti = ramiFallitiDaEsiti(['accounts_down'], esiti);
        expect(falliti[0].errore).toBe('stringa nuda');
    });

    it('reason null/undefined → messaggio segnaposto, il ramo resta identificabile', () => {
        const esiti: PromiseSettledResult<unknown>[] = [{ status: 'rejected', reason: undefined }];
        const falliti = ramiFallitiDaEsiti(['leads_down'], esiti);
        expect(falliti[0].ramo).toBe('leads_down');
        expect(falliti[0].errore.length).toBeGreaterThan(0);
    });

    it('nome mancante per un esito → il fallimento NON si perde, prende un nome posizionale', () => {
        // Difesa contro il drift: se un domani si aggiunge un quarto ramo all'array delle promise
        // e ci si dimentica il nome, il fallimento deve restare visibile.
        const esiti: PromiseSettledResult<unknown>[] = [
            { status: 'fulfilled', value: undefined },
            { status: 'rejected', reason: new Error('ramo senza nome') },
        ];
        const falliti = ramiFallitiDaEsiti(['accounts_down'], esiti);
        expect(falliti).toHaveLength(1);
        expect(falliti[0].ramo).toContain('1');
        expect(falliti[0].errore).toContain('ramo senza nome');
    });
});

/**
 * F-CB.10 / passo 0 — de-posizionalizzare il registro dei rami.
 *
 * Il difetto che questi test chiudono: i nomi vivevano in un array SEPARATO dalle promise, tenuti
 * allineati da una convenzione scritta in un commento. Rimuovere un ramo rinominava tutti gli altri
 * esattamente come aggiungerne uno — e il passo 1 rimuove proprio un ramo (`accounts_down`), quindi
 * senza questo passo il primo fallimento di `leads_down` sarebbe uscito etichettato `accounts_down`.
 *
 * I 6 test qui sopra provano il predicato puro e resterebbero VERDI anche col registro rotto:
 * quello è esattamente il punto per cui questo blocco esiste.
 */
describe('RAMI_SYNC — il registro dei rami non è più posizionale', () => {
    it('caratterizzazione del difetto: con i nomi in un array separato, togliere un ramo rinomina i rimanenti', () => {
        // Meccanismo VECCHIO simulato: 3 nomi fissi, ma solo i 2 rami sopravvissuti eseguiti.
        const nomiSeparatiDallePromise = ['accounts_down', 'leads_down', 'salesnav_up'];
        const esitiDeiDueSopravvissuti: PromiseSettledResult<unknown>[] = [
            { status: 'rejected', reason: new Error('boom-leads') },
            { status: 'rejected', reason: new Error('boom-salesnav') },
        ];
        expect(ramiFallitiDaEsiti(nomiSeparatiDallePromise, esitiDeiDueSopravvissuti).map((f) => f.ramo)).toEqual([
            'accounts_down',
            'leads_down',
        ]);
        // ⇒ due etichette sbagliate su due. È il motivo per cui il registro deve essere UNO.
    });

    it('ogni nome viaggia nello stesso oggetto che porta il suo esecutore', () => {
        expect(RAMI_SYNC.length).toBeGreaterThan(0);
        for (const ramo of RAMI_SYNC) {
            expect(typeof ramo.nome).toBe('string');
            expect(ramo.nome.length).toBeGreaterThan(0);
            expect(typeof ramo.esegui).toBe('function');
        }
    });

    it('amputare un ramo dal registro NON rinomina i rimanenti', async () => {
        const registroAmputato = RAMI_SYNC.filter((r) => r.nome !== 'accounts_down').map((r) => ({
            nome: r.nome,
            esegui: () => Promise.reject(new Error(`boom-${r.nome}`)),
        }));
        const falliti = await eseguiRami(registroAmputato);
        expect(falliti.map((f) => f.ramo)).toEqual(['leads_down', 'salesnav_up']);
        expect(falliti[0].errore).toContain('boom-leads_down');
    });

    it('un ramo che riesce non compare fra i falliti', async () => {
        const falliti = await eseguiRami([
            { nome: 'ok', esegui: () => Promise.resolve() },
            { nome: 'ko', esegui: () => Promise.reject(new Error('boom')) },
        ]);
        expect(falliti.map((f) => f.ramo)).toEqual(['ko']);
    });
});
