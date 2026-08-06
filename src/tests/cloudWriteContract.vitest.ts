/**
 * Contratto di scrittura verso il cloud (F-CB1, goal audit-codebase chat #18).
 *
 * Difetto misurato: `cloudBridge` deposita l'evento in outbox dentro un `.catch(...)`, ma le
 * funzioni di `supabaseDataClient` destrutturavano `{ error }` e facevano solo `logWarn` — e
 * supabase-js con `shouldThrowOnError=false` (default; zero `.throwOnError()` nel repo) converte
 * ANCHE gli errori di rete in una promise risolta (`postgrest-js/src/PostgrestBuilder.ts:239-240`).
 * Quel `.catch` non poteva quindi scattare mai: il fallback era codice morto, e il commento
 * «garantisce retry via sync worker» diceva il falso. Peggio: `applyOutboxOperation`
 * (`supabaseSyncWorker.ts:209`) misura il successo del drain sull'assenza di eccezione, quindi
 * marcava consegnati anche gli eventi rifiutati dal cloud.
 *
 * Questi test mockano il CLIENT SUPABASE, non `supabaseDataClient`: mockare il data client
 * (come fanno `outboxDispatch.vitest.ts` e `salesNavSyncSplit.vitest.ts`) simula un reject che
 * nella realtà non avveniva — un verde che non prova nulla sul contratto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CloudLeadUpsert } from '../cloud/types';

const LEAD_DI_TEST: CloudLeadUpsert = {
    linkedin_url: 'https://www.linkedin.com/in/tizio',
    first_name: 'Tizio',
    last_name: 'Caio',
    job_title: 'Head of Test',
    account_name: 'Acme',
    website: 'https://acme.example',
    list_name: 'lista-di-test',
    status: 'NEW',
};

const stato = vi.hoisted(() => ({
    config: {
        supabaseSyncEnabled: true,
        supabaseUrl: 'https://progetto-di-test.supabase.co',
        supabaseServiceRoleKey: 'chiave-di-test',
    },
    // Esiti pilotabili per singola operazione
    upsertError: null as { message: string } | null,
    updateError: null as { message: string } | null,
    rpcError: null as { message: string } | null,
    selectError: null as { message: string } | null,
    selectData: null as Record<string, number> | null,
    // Righe realmente toccate dall'UPDATE: `count: 'exact'`. 0 = la riga non esisteva, che per
    // Postgres NON è un errore (verificato dal vivo sul progetto reale).
    updateCount: 1 as number,
    // Osservazione: cosa è finito davvero nell'upsert di daily_stats_cloud
    upsertPayloads: [] as Record<string, unknown>[],
}));

vi.mock('../config', () => ({ config: stato.config }));
vi.mock('../telemetry/logger', () => ({
    logWarn: vi.fn(async () => undefined),
    logInfo: vi.fn(async () => undefined),
    logError: vi.fn(async () => undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        from: (table: string) => ({
            upsert: (payload: Record<string, unknown>) => {
                if (table === 'daily_stats_cloud') {
                    stato.upsertPayloads.push(payload);
                    return Promise.resolve({ error: stato.updateError });
                }
                return Promise.resolve({ error: stato.upsertError });
            },
            update: () => ({
                eq: () => Promise.resolve({ error: stato.updateError, count: stato.updateCount }),
            }),
            select: () => ({
                eq: () => ({
                    eq: () => ({
                        // `maybeSingle`: 0 righe ⇒ data null SENZA error (postgrest-js 2.100.1)
                        maybeSingle: () => Promise.resolve({ data: stato.selectData, error: stato.selectError }),
                    }),
                }),
            }),
        }),
        rpc: () => Promise.resolve({ error: stato.rpcError }),
    }),
}));

const ERRORE_DI_RETE = { message: 'Connection terminated due to connection timeout' };

async function importaDataClient() {
    vi.resetModules();
    return import('../cloud/supabaseDataClient');
}

beforeEach(() => {
    stato.config.supabaseSyncEnabled = true;
    stato.config.supabaseUrl = 'https://progetto-di-test.supabase.co';
    stato.config.supabaseServiceRoleKey = 'chiave-di-test';
    stato.upsertError = null;
    stato.updateError = null;
    stato.rpcError = null;
    stato.selectError = null;
    stato.selectData = null;
    stato.updateCount = 1;
    stato.upsertPayloads = [];
    vi.clearAllMocks();
});

describe('scrivere su NULLA non è un errore per Postgres, ma non deve essere invisibile', () => {
    it('health su account inesistente ⇒ logWarn dedicato, e NON un throw', async () => {
        const { updateCloudAccountHealth } = await importaDataClient();
        const { logWarn } = await import('../telemetry/logger');
        stato.updateError = null;
        stato.updateCount = 0; // la riga non esiste: `accounts` cloud non è popolata da nessuno

        // Nessun throw: il retry dell'outbox rifarebbe lo stesso UPDATE a vuoto fino alla DLQ.
        await expect(updateCloudAccountHealth('account-mai-creato', 'RED', 'quarantena')).resolves.toBeUndefined();

        expect(logWarn).toHaveBeenCalledWith(
            'cloud.accounts.health.update.no_row',
            expect.objectContaining({ accountId: 'account-mai-creato', health: 'RED' }),
        );
    });

    it('status su lead non presente nel cloud ⇒ logWarn dedicato', async () => {
        const { updateCloudLeadStatus } = await importaDataClient();
        const { logWarn } = await import('../telemetry/logger');
        stato.updateError = null;
        stato.updateCount = 0;

        await expect(
            updateCloudLeadStatus('https://www.linkedin.com/in/mai-sincronizzato', 'INVITED'),
        ).resolves.toBeUndefined();

        expect(logWarn).toHaveBeenCalledWith(
            'cloud.leads.status.update.no_row',
            expect.objectContaining({ status: 'INVITED' }),
        );
    });

    it('riga trovata ⇒ nessun allarme (il controllo non deve diventare rumore)', async () => {
        const { updateCloudAccountHealth } = await importaDataClient();
        const { logWarn } = await import('../telemetry/logger');
        stato.updateError = null;
        stato.updateCount = 1;

        await updateCloudAccountHealth('account-esistente', 'GREEN');

        expect(logWarn).not.toHaveBeenCalled();
    });
});

describe('supabaseDataClient — un fallimento di scrittura viene PROPAGATO', () => {
    it('upsertCloudLead propaga invece di inghiottire', async () => {
        const { upsertCloudLead } = await importaDataClient();
        stato.upsertError = ERRORE_DI_RETE;
        await expect(upsertCloudLead(LEAD_DI_TEST)).rejects.toThrow(
            /cloud\.leads\.upsert failed/,
        );
    });

    it('updateCloudLeadStatus propaga', async () => {
        const { updateCloudLeadStatus } = await importaDataClient();
        stato.updateError = ERRORE_DI_RETE;
        await expect(
            updateCloudLeadStatus('https://www.linkedin.com/in/tizio', 'INVITED'),
        ).rejects.toThrow(/cloud\.leads\.status\.update failed/);
    });

    it('updateCloudAccountHealth propaga', async () => {
        const { updateCloudAccountHealth } = await importaDataClient();
        stato.updateError = ERRORE_DI_RETE;
        await expect(updateCloudAccountHealth('account-1', 'RED', 'quarantena')).rejects.toThrow(
            /cloud\.accounts\.health\.update failed/,
        );
    });

    it('a sink cloud SPENTO resta un no-op silenzioso: assente ≠ rotto', async () => {
        stato.config.supabaseSyncEnabled = false;
        const { upsertCloudLead } = await importaDataClient();
        stato.upsertError = ERRORE_DI_RETE;
        await expect(upsertCloudLead(LEAD_DI_TEST)).resolves.toBeUndefined();
    });
});

describe('incrementCloudDailyStat — il fallback non può corrompere il contatore', () => {
    it('se la RPC fallisce e la lettura NON riesce, non riscrive nulla e propaga', async () => {
        const { incrementCloudDailyStat } = await importaDataClient();
        stato.rpcError = { message: 'rpc assente' };
        stato.selectError = ERRORE_DI_RETE;

        await expect(
            incrementCloudDailyStat({ local_date: '2026-08-06', account_id: 'a1', field: 'acceptances', amount: 1 }),
        ).rejects.toThrow(/cloud\.daily_stat\.increment failed/);

        // Il punto del test: con la lettura fallita, `current` sarebbe 0 e l'upsert avrebbe
        // scritto `0 + amount`, AZZERANDO il contatore reale. Non deve essere avvenuta scrittura.
        expect(stato.upsertPayloads).toHaveLength(0);
    });

    it('se la RPC fallisce ma è la prima scrittura del giorno (0 righe), la base 0 è legittima', async () => {
        const { incrementCloudDailyStat } = await importaDataClient();
        stato.rpcError = { message: 'rpc assente' };
        stato.selectError = null;
        stato.selectData = null; // maybeSingle: nessuna riga ⇒ data null, error null

        await expect(
            incrementCloudDailyStat({ local_date: '2026-08-06', account_id: 'a1', field: 'acceptances', amount: 3 }),
        ).resolves.toBeUndefined();

        expect(stato.upsertPayloads).toHaveLength(1);
        expect(stato.upsertPayloads[0]?.acceptances).toBe(3);
    });

    it('se la RPC fallisce e la lettura riesce, incrementa sul valore ESISTENTE', async () => {
        const { incrementCloudDailyStat } = await importaDataClient();
        stato.rpcError = { message: 'rpc assente' };
        stato.selectData = { acceptances: 41 };

        await expect(
            incrementCloudDailyStat({ local_date: '2026-08-06', account_id: 'a1', field: 'acceptances', amount: 1 }),
        ).resolves.toBeUndefined();

        expect(stato.upsertPayloads[0]?.acceptances).toBe(42);
    });
});

describe('batchUpsertCloudLeads — «spento» e «rifiutato» non sono più lo stesso esito', () => {
    it('chunk rifiutato ⇒ i lead da ritentare sono NOMINATI, non solo contati', async () => {
        const { batchUpsertCloudLeads } = await importaDataClient();
        stato.upsertError = ERRORE_DI_RETE;

        const esito = await batchUpsertCloudLeads([LEAD_DI_TEST]);

        expect(esito.synced).toBe(0);
        expect(esito.failed).toHaveLength(1);
        expect(esito.failed[0]?.linkedin_url).toBe(LEAD_DI_TEST.linkedin_url);
    });

    it('sink cloud SPENTO ⇒ niente da ritentare (prima era indistinguibile dal fallimento)', async () => {
        stato.config.supabaseSyncEnabled = false;
        const { batchUpsertCloudLeads } = await importaDataClient();

        const esito = await batchUpsertCloudLeads([LEAD_DI_TEST]);

        expect(esito.synced).toBe(0);
        expect(esito.failed).toEqual([]);
    });

    it('scrittura riuscita ⇒ contati e nessun residuo', async () => {
        const { batchUpsertCloudLeads } = await importaDataClient();
        stato.upsertError = null;

        const esito = await batchUpsertCloudLeads([LEAD_DI_TEST]);

        expect(esito.synced).toBe(1);
        expect(esito.failed).toEqual([]);
    });
});

describe('cloudBridge — il fallback outbox ora scatta davvero', () => {
    it('scrittura cloud fallita ⇒ pushOutboxEvent chiamato (prima era codice irraggiungibile)', async () => {
        vi.resetModules();
        // Tipizzare i parametri non è cosmetico: senza, `mock.calls` è una tupla vuota e
        // l'assert sull'argomento non compila (TS2493).
        const pushOutboxEvent = vi.fn(async (_topic: string, _payload: unknown, _key: string) => 1);
        vi.doMock('../core/repositories', () => ({ pushOutboxEvent }));

        const { bridgeLeadUpsert } = await import('../cloud/cloudBridge');
        stato.upsertError = ERRORE_DI_RETE;

        bridgeLeadUpsert(LEAD_DI_TEST);

        await vi.waitFor(() => expect(pushOutboxEvent).toHaveBeenCalledTimes(1));
        expect(pushOutboxEvent.mock.calls[0]?.[0]).toBe('cloud.lead.upsert');

        vi.doUnmock('../core/repositories');
    });

    it('scrittura cloud riuscita ⇒ nessun evento in outbox', async () => {
        vi.resetModules();
        // Tipizzare i parametri non è cosmetico: senza, `mock.calls` è una tupla vuota e
        // l'assert sull'argomento non compila (TS2493).
        const pushOutboxEvent = vi.fn(async (_topic: string, _payload: unknown, _key: string) => 1);
        vi.doMock('../core/repositories', () => ({ pushOutboxEvent }));

        const { bridgeLeadUpsert } = await import('../cloud/cloudBridge');
        stato.upsertError = null;

        bridgeLeadUpsert(LEAD_DI_TEST);

        await new Promise((r) => setTimeout(r, 20));
        expect(pushOutboxEvent).not.toHaveBeenCalled();

        vi.doUnmock('../core/repositories');
    });
});
