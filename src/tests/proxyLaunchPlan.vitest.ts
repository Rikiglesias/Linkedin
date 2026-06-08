import { describe, it, expect } from 'vitest';
import { buildProxyLaunchPlan, isSameProxy } from '../browser/proxyLaunchPlan';

const P1 = { server: 'http://p1.example:8080', username: 'u1', password: 'x1' };
const P2 = { server: 'http://p2.example:8080' };
const STICKY = { server: 'http://sticky.example:9000' };

describe('buildProxyLaunchPlan — FAIL-CLOSED AB-24', () => {
    it('proxy esplicito → solo quello', () => {
        expect(buildProxyLaunchPlan({ explicitProxy: P1, managedProxyEnabled: true, failoverChain: [] })).toEqual([P1]);
    });

    it('managed-proxy NON richiesto → connessione diretta intenzionale [undefined]', () => {
        expect(buildProxyLaunchPlan({ managedProxyEnabled: false, failoverChain: [] })).toEqual([undefined]);
    });

    it('🔴 managed-proxy richiesto MA nessun proxy disponibile → THROW (mai IP diretto)', () => {
        expect(() => buildProxyLaunchPlan({ managedProxyEnabled: true, failoverChain: [] })).toThrow(/AB-24/);
    });

    it('managed-proxy + chain disponibile → ordine chain, nessun undefined', () => {
        const plan = buildProxyLaunchPlan({ managedProxyEnabled: true, failoverChain: [P1, P2] });
        expect(plan).toEqual([P1, P2]);
        expect(plan).not.toContain(undefined);
    });

    it('sticky proxy in testa + chain deduplicata', () => {
        const plan = buildProxyLaunchPlan({
            managedProxyEnabled: true,
            stickyProxy: STICKY,
            failoverChain: [STICKY, P1], // STICKY duplicato → deve comparire una sola volta
        });
        expect(plan).toEqual([STICKY, P1]);
    });

    it('sticky disponibile salva dal fail-closed anche con chain vuota', () => {
        expect(buildProxyLaunchPlan({ managedProxyEnabled: true, stickyProxy: STICKY, failoverChain: [] })).toEqual([
            STICKY,
        ]);
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
