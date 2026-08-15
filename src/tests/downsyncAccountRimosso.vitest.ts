/**
 * F-CB.10 / passo 1 — D2 = Strada B+: la catena di downsync degli account è RIMOSSA.
 *
 * Il difetto: `applyCloudAccountUpdates` faceva `UPDATE accounts` su una tabella che nel DB locale
 * **non esiste** (57 tabelle, zero `CREATE TABLE accounts` in 73 migration). Era inerte solo perché
 * la tabella cloud `accounts` è vuota — cioè per via di D1: dichiarare gli account l'avrebbe ACCESA.
 *
 * Perché rimuovere invece di correggere la destinazione: quel ramo dava a una tabella cloud senza
 * comandante l'autorità di **rilasciare** la quarantena. Con un solo account configurato
 * `MULTI_ACCOUNT_ENABLED` è false, l'id degrada al sintetico `'default'`, e
 * `setAccountQuarantine('default', false)` scrive il flag GLOBALE che sblocca OGNI account.
 * Verdetto integrale in `PLAN-REVIEW-VERDICT.md`; decisione in `~/todos/audit-codebase.md`.
 *
 * zero-Q (dopo ≥ prima) col metro del COMPORTAMENTO: quel ramo consegnava zero capability — poteva
 * solo lanciare `no such table`, e se non avesse lanciato avrebbe scritto colonne che nessun gate
 * legge (i gate leggono i runtime flag di `sync_state`).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RAMI_SYNC } from '../cloud/controlPlaneSync';

const SRC = path.resolve(__dirname, '..');

/** Tutti i `.ts` di produzione: i test sono esclusi perché è lì che i pattern vietati si NOMINANO. */
function fileDiProduzione(dir: string, acc: string[] = []): string[] {
    for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, voce.name);
        if (voce.isDirectory()) {
            if (voce.name === 'tests' || voce.name === 'node_modules') continue;
            fileDiProduzione(completo, acc);
        } else if (voce.name.endsWith('.ts')) {
            acc.push(completo);
        }
    }
    return acc;
}

function occorrenze(pattern: RegExp): string[] {
    const trovate: string[] = [];
    for (const file of fileDiProduzione(SRC)) {
        const righe = fs.readFileSync(file, 'utf8').split('\n');
        righe.forEach((riga, i) => {
            if (pattern.test(riga)) trovate.push(`${path.relative(SRC, file)}:${i + 1}`);
            pattern.lastIndex = 0;
        });
    }
    return trovate;
}

describe('D2 = B+ — la catena downsync degli account non esiste più', () => {
    it('il registro dei rami ha esattamente 2 rami: leads_down e salesnav_up', () => {
        expect(RAMI_SYNC.map((r) => r.nome)).toEqual(['leads_down', 'salesnav_up']);
    });

    it('nessun percorso di produzione scrive la tabella locale `accounts`', () => {
        // Sentinella: impedisce che il ramo torni per inerzia. La tabella NON esiste in locale.
        expect(occorrenze(/UPDATE\s+accounts/i)).toEqual([]);
    });

    it('nessun percorso di produzione legge la tabella cloud `accounts` per riportarla in locale', () => {
        expect(occorrenze(/from\(['"]accounts['"]\)\s*\.\s*select/)).toEqual([]);
    });

    it('le funzioni della catena non esistono più nel codice di produzione', () => {
        expect(occorrenze(/\b(syncAccountsDown|applyCloudAccountUpdates|fetchCloudAccountsUpdates)\b/)).toEqual([]);
    });

    it('il cursore del ramo rimosso non resta orfano', () => {
        expect(occorrenze(/control_plane\.accounts\.last_sync_at/)).toEqual([]);
    });
});
