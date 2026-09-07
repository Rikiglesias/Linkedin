import { describe, it, expect } from 'vitest';
import { buildProxyLaunchPlan, isSameProxy } from '../browser/proxyLaunchPlan';

const P1 = { server: 'http://p1.example:8080', username: 'u1', password: 'x1' };
const P2 = { server: 'http://p2.example:8080' };
const STICKY = { server: 'http://sticky.example:9000' };

/**
 * C26 ha reso `requireProxyForAuth` e `sessionHasCookies` obbligatori: qui restano entrambi `false`
 * perche' questi casi descrivono il fail-closed AB-24 (pool esaurito), che e' indipendente dalla
 * policy di autenticazione. Il fail-closed AB1 (sessione con cookie senza proxy) ha il suo file:
 * `proxyFailClosedNoInfra.vitest.ts`.
 */
const NO_AUTH_POLICY = { requireProxyForAuth: false, sessionHasCookies: false } as const;

describe('buildProxyLaunchPlan — FAIL-CLOSED AB-24', () => {
    it('proxy esplicito → solo quello', () => {
        expect(
            buildProxyLaunchPlan({ explicitProxy: P1, managedProxyEnabled: true, failoverChain: [], ...NO_AUTH_POLICY }),
        ).toEqual([P1]);
    });

    it('managed-proxy NON richiesto → connessione diretta intenzionale [undefined]', () => {
        expect(buildProxyLaunchPlan({ managedProxyEnabled: false, failoverChain: [], ...NO_AUTH_POLICY })).toEqual([
            undefined,
        ]);
    });

    it('🔴 managed-proxy richiesto MA nessun proxy disponibile → THROW (mai IP diretto)', () => {
        expect(() => buildProxyLaunchPlan({ managedProxyEnabled: true, failoverChain: [], ...NO_AUTH_POLICY })).toThrow(
            /AB-24/,
        );
    });

    it('managed-proxy + chain disponibile → ordine chain, nessun undefined', () => {
        const plan = buildProxyLaunchPlan({ managedProxyEnabled: true, failoverChain: [P1, P2], ...NO_AUTH_POLICY });
        expect(plan).toEqual([P1, P2]);
        expect(plan).not.toContain(undefined);
    });

    it('sticky proxy in testa + chain deduplicata', () => {
        const plan = buildProxyLaunchPlan({
            managedProxyEnabled: true,
            stickyProxy: STICKY,
            failoverChain: [STICKY, P1], // STICKY duplicato → deve comparire una sola volta
            ...NO_AUTH_POLICY,
        });
        expect(plan).toEqual([STICKY, P1]);
    });

    it('sticky disponibile salva dal fail-closed anche con chain vuota', () => {
        expect(
            buildProxyLaunchPlan({
                managedProxyEnabled: true,
                stickyProxy: STICKY,
                failoverChain: [],
                ...NO_AUTH_POLICY,
            }),
        ).toEqual([STICKY]);
    });
});

describe('isSameProxy', () => {
    it('confronta server+username+password; undefined non è mai uguale', () => {
        expect(isSameProxy(P1, { ...P1 })).toBe(true);
        expect(isSameProxy(P1, P2)).toBe(false);
        expect(isSameProxy(undefined, P1)).toBe(false);
        expect(isSameProxy(undefined, undefined)).toBe(false);
    });
});
