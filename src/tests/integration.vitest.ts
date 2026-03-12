/**
 * tests/integration.vitest.ts
 * ─────────────────────────────────────────────────────────────────
 * Wrapper vitest per i test di integrazione legacy (integration.ts).
 * Esegue l'intero flusso in un singolo test con timeout esteso.
 *
 * Il file integration.ts (1736 righe) testa end-to-end:
 *   - CRM pull (HubSpot mock)
 *   - Lead enrichment (Hunter mock)
 *   - AI personalization (OpenAI/Ollama mock)
 *   - Secret rotation
 *   - Lead state machine transitions
 *   - Scheduler + campaigns
 *   - Selector learner
 *   - Timing optimizer + ramp-up
 *   - HTTP API (health, KPIs, stats, auth, session, export)
 *
 * I test girano con un DB SQLite temporaneo e fetch mockato.
 */

import { describe, test, expect } from 'vitest';

describe('Integration Tests (legacy wrapper)', () => {
    test('full integration suite passes', async () => {
        const { run } = await import('./integration');
        await expect(run()).resolves.toBeUndefined();
    }, 120_000);
});
