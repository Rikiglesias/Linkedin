/**
 * loginRequiredGraduato.vitest.ts — C27 del contratto `bot-operativo` (blocco A).
 *
 * Il difetto: `checkLogin` (`auth.ts:143`) restituisce `false` sia quando la sessione e' davvero
 * scaduta sia quando LinkedIn risponde 429 o 403. A valle `workflowEntryGuards.ts:112` legge quel
 * `false` come «sloggato» e mette l'account in QUARANTENA con il messaggio «eseguire bot.ps1 login».
 * Cioe': davanti a un rate-limit temporaneo il bot chiede di rifare il login — la reazione peggiore
 * possibile, perche' un'autenticazione nuova sotto throttling aggiunge segnali proprio quando
 * LinkedIn sta gia' guardando. E lo stesso 429, letto da tre punti diversi, produceva tre reazioni
 * diverse: pausa `LINKEDIN_PRE_THROTTLED`, quarantena `LOGIN_REQUIRED`, proxy bruciato.
 *
 * La regola dopo il fix: la CAUSA del fallimento e' un dato, non un booleano. Tre rami distinti —
 * sessione scaduta, esito ignoto (rete/timeout/proxy), throttling della piattaforma — e per il terzo
 * un solo trattamento, da qualunque punto arrivi: pausa lunga con backoff, proxy sticky rilasciato,
 * MAI quarantena e MAI la richiesta di rifare il login.
 */
import { describe, it, expect } from 'vitest';
import {
    classifyCheckLoginStatus,
    classifyProbeReason,
    classifyVoyagerStatus,
    resolveLoginFailureAction,
    type LoginCheckOutcome,
} from '../browser/loginFailurePolicy';

/** Default REALE letto alla fonte: `domains.ts:68` (`AUTO_PAUSE_MINUTES_ON_FAILURE_BURST`, 180). */
const AUTO_PAUSE = 180;
const opts = { autoPauseMinutes: AUTO_PAUSE };

describe('C27 — i tre rami del fallimento di login', () => {
    it('(a) logout ESPLICITO: quarantena per-account e pausa 60 minuti', () => {
        const a = resolveLoginFailureAction({ state: 'logged-out' }, opts);
        expect(a.reason).toBe('LOGIN_REQUIRED');
        expect(a.quarantine).toBe(true);
        expect(a.pauseMinutes).toBe(60);
        expect(a.releaseProxy).toBe(false);
    });

    it('(b) timeout di navigazione: esito IGNOTO, pausa breve, MAI quarantena', () => {
        const a = resolveLoginFailureAction({ state: 'unknown', cause: 'timeout' }, opts);
        expect(a.reason).toBe('login_check_unknown');
        expect(a.quarantine).toBe(false);
        expect(a.pauseMinutes).not.toBeNull();
        expect(a.pauseMinutes as number).toBeLessThanOrEqual(15);
    });

    it('(b) errore di proxy: stesso ramo IGNOTO — un proxy lento non e una sessione scaduta', () => {
        const a = resolveLoginFailureAction({ state: 'unknown', cause: 'proxy' }, opts);
        expect(a.reason).toBe('login_check_unknown');
        expect(a.quarantine).toBe(false);
        expect(a.pauseMinutes as number).toBeLessThanOrEqual(15);
    });

    it('(c) 429 dal probe del feed: pausa >= 180, proxy rilasciato, nessuna quarantena', () => {
        const outcome = classifyProbeReason('HTTP_429_RATE_LIMITED');
        const a = resolveLoginFailureAction(outcome, opts);
        expect(a.reason).toBe('HTTP_429_RATE_LIMIT');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('(c) 429 da checkLogin: STESSO esito, e soprattutto NON LOGIN_REQUIRED', () => {
        const outcome = classifyCheckLoginStatus(429);
        const a = resolveLoginFailureAction(outcome, opts);
        expect(a.reason).toBe('HTTP_429_RATE_LIMIT');
        expect(a.reason).not.toBe('LOGIN_REQUIRED');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('(c) 429 dalla chiamata voyager: STESSO esito, dal terzo punto', () => {
        const a = resolveLoginFailureAction(classifyVoyagerStatus(429), opts);
        expect(a.reason).toBe('HTTP_429_RATE_LIMIT');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('(c) 403 bloccato: stesso trattamento del 429, con il suo incident', () => {
        const a = resolveLoginFailureAction(classifyCheckLoginStatus(403), opts);
        expect(a.reason).toBe('HTTP_403_BLOCKED');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('i tre punti danno lo STESSO outcome per lo stesso 429: una causa, una reazione', () => {
        const daProbe = classifyProbeReason('HTTP_429_RATE_LIMITED');
        const daCheck = classifyCheckLoginStatus(429);
        const daVoyager = classifyVoyagerStatus(429);
        expect(daProbe).toEqual(daCheck);
        expect(daCheck).toEqual(daVoyager);
    });

    it('sessione viva: nessuna azione, nessuna pausa', () => {
        const a = resolveLoginFailureAction({ state: 'logged-in' } as LoginCheckOutcome, opts);
        expect(a.pauseMinutes).toBeNull();
        expect(a.quarantine).toBe(false);
        expect(a.incidentType).toBeNull();
    });

    it('il probe che riporta SESSION_EXPIRED resta il ramo (a), non si confonde col throttling', () => {
        const a = resolveLoginFailureAction(classifyProbeReason('SESSION_EXPIRED'), opts);
        expect(a.reason).toBe('LOGIN_REQUIRED');
        expect(a.quarantine).toBe(true);
    });

    it('un errore di rete del probe finisce nel ramo IGNOTO, non in quarantena', () => {
        const a = resolveLoginFailureAction(classifyProbeReason('PROBE_ERROR: net::ERR_TIMED_OUT'), opts);
        expect(a.reason).toBe('login_check_unknown');
        expect(a.quarantine).toBe(false);
    });
});
