import { describe, test, expect, afterEach } from 'vitest';
import { getDatabase } from '../db';
import { claimPendingOutboxDeliveries } from '../core/repositories/outboxDeliveries';

/**
 * Una consegna presa in carico da un processo che poi muore resta in stato RUNNING con la
 * scadenza del lease ormai passata. Il claim guardava solo `status = 'PENDING'`, quindi quella
 * riga non veniva mai più selezionata: la scadenza c'era ma non serviva a nulla, e la consegna
 * restava in coda per sempre — contata ancora come «da fare» da `countPendingOutboxDeliveries`,
 * senza che nessuno la facesse.
 *
 * Il gemello sugli EVENTI (`repositories/system.ts:174`) è scritto giusto: non ha uno stato,
 * filtra su `delivered_at IS NULL` più la scadenza, quindi recupera da solo. Questo test tiene
 * insieme le due implementazioni.
 *
 * Gira sulla COPIA del database usata dai test (`src/tests/setup/`), mai su quello vivo, e
 * ripulisce le righe che crea.
 */

const CHIAVE_DI_PROVA = 'test-lease-scaduto';
const idsCreati: { eventi: number[]; consegne: number[] } = { eventi: [], consegne: [] };

async function creaConsegna(stato: string, scadenzaLease: string | null): Promise<number> {
    const db = await getDatabase();
    // Chiave unica per ritrovare le righe: gli id NON si leggono da `lastID` ma si rileggono dal
    // database. Con una connessione condivisa e più statement in volo, fidarsi dell'ultimo id
    // inserito significa costruire l'asserzione su un numero che può non essere il proprio.
    const chiave = `${CHIAVE_DI_PROVA}:${Date.now()}:${Math.random()}`;
    await db.run(
        `INSERT INTO outbox_events (topic, payload_json, idempotency_key, next_retry_at)
         VALUES ('test.lease', '{}', ?, DATETIME('now', '-1 hour'))`,
        [chiave],
    );
    const evento = await db.get<{ id: number }>(`SELECT id FROM outbox_events WHERE idempotency_key = ?`, [chiave]);
    const eventId = Number(evento?.id);
    idsCreati.eventi.push(eventId);

    await db.run(
        `INSERT INTO outbox_event_deliveries
             (event_id, sink, status, next_retry_at, processing_owner, processing_expires_at)
         VALUES (?, 'WEBHOOK', ?, DATETIME('now', '-1 hour'), ?, ?)`,
        [eventId, stato, stato === 'RUNNING' ? 'processo-morto' : null, scadenzaLease],
    );
    const consegna = await db.get<{ id: number }>(`SELECT id FROM outbox_event_deliveries WHERE event_id = ?`, [
        eventId,
    ]);
    const deliveryId = Number(consegna?.id);
    idsCreati.consegne.push(deliveryId);
    return deliveryId;
}

afterEach(async () => {
    const db = await getDatabase();
    for (const id of idsCreati.consegne) {
        await db.run(`DELETE FROM outbox_event_deliveries WHERE id = ?`, [id]);
    }
    for (const id of idsCreati.eventi) {
        await db.run(`DELETE FROM outbox_events WHERE id = ?`, [id]);
    }
    idsCreati.consegne.length = 0;
    idsCreati.eventi.length = 0;
});

describe('claimPendingOutboxDeliveries — una consegna abbandonata deve poter essere ripresa', () => {
    test('lease SCADUTO su una consegna RUNNING: viene ripresa', async () => {
        // Il processo che l'aveva presa non c'è più: la scadenza è passata da un'ora.
        const deliveryId = await creaConsegna('RUNNING', "DATETIME('now', '-1 hour')");
        const db = await getDatabase();
        await db.run(
            `UPDATE outbox_event_deliveries SET processing_expires_at = DATETIME('now', '-1 hour') WHERE id = ?`,
            [deliveryId],
        );

        const riprese = await claimPendingOutboxDeliveries('WEBHOOK', 50, 'worker-nuovo', 60);

        expect(riprese.map((r) => r.delivery_id)).toContain(deliveryId);
    });

    test('lease ANCORA VALIDO su una consegna RUNNING: NON viene rubata', async () => {
        // Il guadagno non deve diventare un danno: se un altro processo ci sta lavorando davvero,
        // due worker sulla stessa consegna significherebbero consegne doppie.
        const deliveryId = await creaConsegna('RUNNING', null);
        const db = await getDatabase();
        await db.run(
            `UPDATE outbox_event_deliveries SET processing_expires_at = DATETIME('now', '+1 hour') WHERE id = ?`,
            [deliveryId],
        );

        const riprese = await claimPendingOutboxDeliveries('WEBHOOK', 50, 'worker-intruso', 60);

        expect(riprese.map((r) => r.delivery_id)).not.toContain(deliveryId);
    });

    test('una consegna PENDING normale continua a essere presa', async () => {
        // Guardia di non-regressione sul caso ordinario.
        const deliveryId = await creaConsegna('PENDING', null);

        const riprese = await claimPendingOutboxDeliveries('WEBHOOK', 50, 'worker-nuovo', 60);

        expect(riprese.map((r) => r.delivery_id)).toContain(deliveryId);
    });
});
