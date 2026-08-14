import { describe, it, expect } from 'vitest';
import { ramiFallitiDaEsiti } from '../cloud/controlPlaneSync';

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
