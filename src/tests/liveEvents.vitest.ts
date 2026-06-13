import { describe, it, expect } from 'vitest';
import {
    publishLiveEvent,
    subscribeLiveEvents,
    getLiveEventSubscribersCount,
    type LiveEventMessage,
} from '../telemetry/liveEvents';

// A11-2 (audit-bot): ring buffer + replay-on-subscribe per gli eventi CRITICI, così una dashboard
// offline recupera nel live-feed gli incidenti avvenuti durante la disconnessione. I test cercano
// eventi per payload univoco → robusti allo stato del buffer accumulato tra i test.
describe('liveEvents — replay degli eventi critici (A11-2)', () => {
    it('bufferizza un evento CRITICO e lo replay-a al subscribe con _replayed: true', () => {
        publishLiveEvent('incident.opened', { incidentId: 99901 });

        const received: LiveEventMessage[] = [];
        const unsub = subscribeLiveEvents((e) => received.push(e));
        unsub();

        const replayed = received.find(
            (e) => e.type === 'incident.opened' && e.payload.incidentId === 99901,
        );
        expect(replayed).toBeDefined();
        expect(replayed?.payload._replayed).toBe(true);
    });

    it('NON bufferizza un evento EFFIMERO ad alto volume (nessun replay)', () => {
        publishLiveEvent('lead.transition', { _marker: 'ephemeral-77770' });

        const received: LiveEventMessage[] = [];
        const unsub = subscribeLiveEvents((e) => received.push(e));
        unsub();

        const found = received.find((e) => e.payload._marker === 'ephemeral-77770');
        expect(found).toBeUndefined();
    });

    it('consegna gli eventi LIVE ai listener correnti senza marker _replayed', () => {
        const received: LiveEventMessage[] = [];
        const unsub = subscribeLiveEvents((e) => received.push(e));
        received.length = 0; // scarta il replay iniziale del buffer

        publishLiveEvent('incident.opened', { incidentId: 88820 });
        unsub();

        const live = received.find((e) => e.payload.incidentId === 88820);
        expect(live).toBeDefined();
        expect(live?.payload._replayed).toBeUndefined();
    });

    it('unsubscribe ferma la consegna degli eventi successivi', () => {
        const received: LiveEventMessage[] = [];
        const unsub = subscribeLiveEvents((e) => received.push(e));
        unsub();
        received.length = 0;

        publishLiveEvent('automation.paused', { incidentId: 77730 });

        const found = received.find((e) => e.payload.incidentId === 77730);
        expect(found).toBeUndefined();
    });

    it('traccia il numero di subscriber (add/remove)', () => {
        const before = getLiveEventSubscribersCount();
        const unsub = subscribeLiveEvents(() => {});
        expect(getLiveEventSubscribersCount()).toBe(before + 1);
        unsub();
        expect(getLiveEventSubscribersCount()).toBe(before);
    });
});
