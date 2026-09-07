/**
 * proxyFailClosedNoInfra.vitest.ts — C26 del contratto `bot-operativo` (blocco A).
 *
 * Il buco che chiude: la guardia AB1 (`launcher.ts:245`) e' una congiunzione di QUATTRO condizioni,
 * fra cui `proxyInfraConfigured`. Con ZERO proxy configurati quella condizione e' falsa, quindi la
 * guardia non scatta, `managedProxyEnabled` diventa false e `buildProxyLaunchPlan` restituisce
 * `[undefined]` = connessione DIRETTA — anche su una sessionDir con cookie di LinkedIn e con
 * `REQUIRE_PROXY_FOR_AUTH=true`. Cioe': proprio la configurazione che chiede «mai senza proxy su
 * sessione autenticata» e' quella che degrada in silenzio quando i proxy mancano del tutto.
 *
 * Regola dopo il fix: con `requireProxyForAuth` e sessione che HA cookie, un piano che contenga una
 * connessione diretta non e' rappresentabile — si lancia, mai si degrada. L'unica uscita e'
 * `allowDirectIp`, esplicito, per i flussi legittimamente diretti (create-profile su IP fresco,
 * diagnostica).
 */
import { describe, it, expect } from 'vitest';
import { buildProxyLaunchPlan } from '../browser/proxyLaunchPlan';

const P1 = { server: 'http://p1.example:8080', username: 'u1', password: 'x1' };

describe('C26 — proxy fail-closed anche SENZA infrastruttura proxy', () => {
    it('zero proxy + requireProxyForAuth + sessione con cookie → THROW AB1, mai [undefined]', () => {
        expect(() =>
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: true,
            }),
        ).toThrow(/AB1/);
    });

    it("il piano non contiene MAI una diretta quando la sessione e' autenticata e il proxy e' richiesto", () => {
        // Anche col proxy gestito attivo e una chain disponibile: nessun `undefined` deve passare.
        const plan = buildProxyLaunchPlan({
            managedProxyEnabled: true,
            failoverChain: [P1],
            requireProxyForAuth: true,
            sessionHasCookies: true,
        });
        expect(plan).not.toContain(undefined);
        expect(plan).toEqual([P1]);
    });

    it("sessione SENZA cookie → la diretta resta legittima (profilo vergine, nessuna identita' esposta)", () => {
        expect(
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: false,
            }),
        ).toEqual([undefined]);
    });

    it('requireProxyForAuth OFF → comportamento invariato (default del progetto, nessuna regressione)', () => {
        expect(
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: false,
                sessionHasCookies: true,
            }),
        ).toEqual([undefined]);
    });

    it('allowDirectIp esplicito → uscita legittima anche su sessione con cookie', () => {
        expect(
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: true,
                allowDirectIp: true,
            }),
        ).toEqual([undefined]);
    });

    it('il messaggio AB1 dice cosa fare, non solo che ha rifiutato', () => {
        try {
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: true,
            });
            throw new Error('atteso throw');
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain('AB1');
            expect(msg).toMatch(/proxy/i);
            expect(msg).toMatch(/allowDirectIp|REQUIRE_PROXY_FOR_AUTH/);
        }
    });
});
