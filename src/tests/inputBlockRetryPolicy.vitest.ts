/**
 * inputBlockRetryPolicy.vitest.ts
 * ─────────────────────────────────────────────────────────────────
 * C29 — residuo trovato dalla review a due lenti (regressione introdotta dal fix di C29 stesso).
 *
 * Prima di C29, `pauseInputBlock` su pagina chiusa usciva in silenzio e il successivo
 * `page.mouse.click` lanciava «Target page, context or browser has been closed», che
 * `resolveWorkerRetryPolicy` riconosceva come transitorio. Dopo C29 l'errore diventa
 * `InputBlockAcquireError` con messaggio `input_block_acquire_failed:page_closed`, che NON contiene
 * nessuno dei pattern transitori: cade in `UNCLASSIFIED` → `retryable: true` a piena capacita'.
 * Su sessione morta il worker ri-naviga e ri-attende a ogni tentativo per ri-fallire: e' ritmo che
 * LinkedIn misura (ANTI-BAN).
 *
 * La root cause non e' il singolo caso, e' la CLASSIFICAZIONE PER STRINGA: la policy deve leggere il
 * campo tipizzato `reason`, non il testo del messaggio.
 */
import { describe, it, expect } from 'vitest';
import { resolveWorkerRetryPolicy, INPUT_BLOCK_ACQUIRE_REASONS } from '../workers/errors';
import { InputBlockAcquireError } from '../browser/human/inputBlock';

const MAX_ATTEMPTS_DEFAULT = 5;
const BASE_DELAY_MS = 1000;

describe('C29 — policy di retry per InputBlockAcquireError (letta dal campo `reason`, non dal testo)', () => {
    it('page_closed NON e\' ritentabile: la sessione e\' finita, il run va fermato', () => {
        const policy = resolveWorkerRetryPolicy(
            new InputBlockAcquireError('page_closed'),
            MAX_ATTEMPTS_DEFAULT,
            BASE_DELAY_MS,
        );

        expect(policy.retryable).toBe(false);
        expect(policy.maxAttempts).toBe(1);
        expect(policy.baseDelayMs).toBe(0);
        expect(policy.code).toBe('INPUT_BLOCK_PAGE_CLOSED');
    });

    it('evaluate_failed e\' transitorio: ritenta, ma a capacita\' ridotta', () => {
        const policy = resolveWorkerRetryPolicy(
            new InputBlockAcquireError('evaluate_failed', 'Execution context was destroyed'),
            MAX_ATTEMPTS_DEFAULT,
            BASE_DELAY_MS,
        );

        expect(policy.retryable).toBe(true);
        expect(policy.maxAttempts).toBeLessThanOrEqual(3);
        expect(policy.category).toBe('ui_transient');
        expect(policy.code).toBe('INPUT_BLOCK_EVALUATE_FAILED');
    });

    /**
     * Il test che distingue «leggo il campo tipizzato» da «leggo la stringa»: se la classificazione
     * passasse ancora dal messaggio, questo caso finirebbe fra i transitori (contiene «navigation»)
     * e tornerebbe ritentabile — cioe' esattamente la regressione.
     */
    it('il messaggio non governa la decisione: page_closed resta non-ritentabile anche con un testo transitorio', () => {
        const errore = new InputBlockAcquireError('page_closed');
        Object.defineProperty(errore, 'message', {
            value: 'navigation timeout: net:: context closed',
            configurable: true,
        });

        const policy = resolveWorkerRetryPolicy(errore, MAX_ATTEMPTS_DEFAULT, BASE_DELAY_MS);

        expect(policy.retryable).toBe(false);
        expect(policy.maxAttempts).toBe(1);
    });

    /**
     * Sentinella di CLASSE: un `reason` nuovo aggiunto domani non deve poter cadere in silenzio nel
     * ramo permissivo. Il tipo e questa lista sono la stessa cosa (`INPUT_BLOCK_ACQUIRE_REASONS` e'
     * la fonte del tipo), quindi la dimenticanza diventa un test rosso.
     */
    it('ogni reason ha una policy esplicita: nessuno cade in UNCLASSIFIED', () => {
        const senzaPolicy = INPUT_BLOCK_ACQUIRE_REASONS.filter((reason) => {
            const policy = resolveWorkerRetryPolicy(
                new InputBlockAcquireError(reason),
                MAX_ATTEMPTS_DEFAULT,
                BASE_DELAY_MS,
            );
            return policy.code === 'UNCLASSIFIED' || policy.category === 'unknown';
        });

        expect(senzaPolicy).toEqual([]);
        expect(INPUT_BLOCK_ACQUIRE_REASONS.length).toBeGreaterThan(0);
    });

    // Controllo positivo: il resto della classificazione non e' stato toccato.
    it('controllo positivo: gli errori generici restano classificati come prima', () => {
        const transitorio = resolveWorkerRetryPolicy(
            new Error('Timeout 30000ms exceeded'),
            MAX_ATTEMPTS_DEFAULT,
            BASE_DELAY_MS,
        );
        expect(transitorio.category).toBe('ui_transient');
        expect(transitorio.retryable).toBe(true);

        const sconosciuto = resolveWorkerRetryPolicy(new Error('boom'), MAX_ATTEMPTS_DEFAULT, BASE_DELAY_MS);
        expect(sconosciuto.code).toBe('UNCLASSIFIED');
        expect(sconosciuto.retryable).toBe(true);
    });
});
