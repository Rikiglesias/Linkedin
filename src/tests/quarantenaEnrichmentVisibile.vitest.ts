import { beforeEach, describe, expect, test, vi } from 'vitest';

// La quarantena aperta dall'enrichment deve fermare il bot davvero.
//
// `companyEnrichment.ts` apriva la sessione col cookie jar dell'account DEFAULT
// (`config.sessionDir`, vedi `launcher.ts:246`) ma, se quel jar risultava non autenticato,
// chiamava `quarantineAccount` con `accountId: 'company-enrichment'`. Quella stringa non e'
// un profilo runtime: nessun gate la interroga. I lettori veri chiedono l'id del profilo
// attivo — `loopCommand.ts:407`, `jobRunner.ts:1437`, `workflowEntryGuards.ts:358` — quindi
// la protezione si accendeva su un'identita' che nessuno guarda, mentre il jar davvero
// sospetto restava libero di lavorare.
//
// Il test difende l'EFFETTO (il gate vede la quarantena), non la forma della chiamata.

const syncState = new Map<string, string>();

vi.mock('../db', () => ({
    getDatabase: async () => ({
        run: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('INSERT INTO sync_state')) {
                syncState.set(String(params[0]), String(params[1]));
                return { changes: 1 };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        get: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('SELECT value FROM sync_state')) {
                const value = syncState.get(String(params[0]));
                return value === undefined ? undefined : { value };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        query: async () => [],
    }),
}));

import { getAccountQuarantine, setAccountQuarantine } from '../core/repositories/system';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('la quarantena dell’enrichment è visibile ai gate', () => {
    beforeEach(() => {
        syncState.clear();
    });

    test('quarantena su un id che non è un profilo runtime: i gate NON la vedono', async () => {
        // Questo test documenta il meccanismo che rendeva inerte il fail-safe.
        await setAccountQuarantine('company-enrichment', true);

        expect(await getAccountQuarantine('default')).toBe(false);
    });

    test('quarantena senza id esplicito: diventa il flag globale, e i gate la vedono', async () => {
        await setAccountQuarantine('default', true);

        expect(await getAccountQuarantine('default')).toBe(true);
        expect(await getAccountQuarantine('un-altro-account')).toBe(true);
    });

    test('l’enrichment non etichetta più la quarantena con un id che nessuno legge', () => {
        // Sentinella di forma: il difetto sta nel PASSARE `accountId` a `quarantineAccount`,
        // perche' e' quello il campo che diventa la CHIAVE della quarantena (`resolveAccountId`).
        // L'etichetta di provenienza puo' restare, ma sotto un altro nome.
        const sorgente = readFileSync(join(__dirname, '..', 'core', 'companyEnrichment.ts'), 'utf8');

        const chiamata = sorgente.match(/quarantineAccount\([\s\S]{0,400}?\)\s*;/);
        expect(chiamata, 'quarantineAccount non trovata in companyEnrichment.ts').toBeTruthy();
        expect(chiamata?.[0]).not.toMatch(/\baccountId\s*:/);
    });
});
