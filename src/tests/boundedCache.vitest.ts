import { describe, expect, it } from 'vitest';

import { BoundedMap, BoundedSet } from '../utils/boundedCache';

/**
 * Copre BoundedMap (LRU) e BoundedSet (FIFO): API drop-in + eviction al cap +
 * conservazione dei valori null + promozione recency. Scopo: garantire che il
 * tetto impedisca la crescita illimitata senza alterare la semantica di cache.
 */

describe('BoundedMap', () => {
    it('get/set/has/delete di base', () => {
        const m = new BoundedMap<string, number>(10);
        expect(m.has('a')).toBe(false);
        expect(m.get('a')).toBeUndefined();
        m.set('a', 1);
        expect(m.has('a')).toBe(true);
        expect(m.get('a')).toBe(1);
        expect(m.size).toBe(1);
        expect(m.delete('a')).toBe(true);
        expect(m.has('a')).toBe(false);
    });

    it('conserva il valore null (assenza distinguibile solo via has)', () => {
        const m = new BoundedMap<string, number | null>(10);
        m.set('x', null);
        expect(m.has('x')).toBe(true);
        expect(m.get('x')).toBeNull();
        // get di una chiave assente resta undefined, non null
        expect(m.get('y')).toBeUndefined();
    });

    it('evince la chiave più vecchia oltre il cap (LRU)', () => {
        const m = new BoundedMap<string, number>(3);
        m.set('a', 1);
        m.set('b', 2);
        m.set('c', 3);
        m.set('d', 4); // supera il cap → evince 'a' (least-recently-used)
        expect(m.size).toBe(3);
        expect(m.has('a')).toBe(false);
        expect(m.has('d')).toBe(true);
    });

    it('get promuove a most-recently-used → la chiave letta sopravvive', () => {
        const m = new BoundedMap<string, number>(3);
        m.set('a', 1);
        m.set('b', 2);
        m.set('c', 3);
        expect(m.get('a')).toBe(1); // promuove 'a' in coda
        m.set('d', 4); // evince ora il LRU = 'b', non 'a'
        expect(m.has('a')).toBe(true);
        expect(m.has('b')).toBe(false);
        expect(m.has('d')).toBe(true);
    });

    it('set su chiave esistente aggiorna valore + recency senza crescere', () => {
        const m = new BoundedMap<string, number>(3);
        m.set('a', 1);
        m.set('b', 2);
        m.set('c', 3);
        m.set('a', 99); // refresh: 'a' diventa most-recent, size invariata
        expect(m.size).toBe(3);
        expect(m.get('a')).toBe(99);
        m.set('d', 4); // evince il LRU = 'b'
        expect(m.has('a')).toBe(true);
        expect(m.has('b')).toBe(false);
    });

    it('cap < 1 viene normalizzato ad almeno 1', () => {
        const m = new BoundedMap<string, number>(0);
        m.set('a', 1);
        m.set('b', 2);
        expect(m.size).toBe(1);
        expect(m.has('b')).toBe(true);
    });
});

describe('BoundedSet', () => {
    it('has/add/delete di base + idempotenza add', () => {
        const s = new BoundedSet<string>(10);
        expect(s.has('a')).toBe(false);
        s.add('a');
        s.add('a'); // idempotente
        expect(s.has('a')).toBe(true);
        expect(s.size).toBe(1);
        expect(s.delete('a')).toBe(true);
        expect(s.has('a')).toBe(false);
    });

    it('evince il più vecchio inserito oltre il cap (FIFO)', () => {
        const s = new BoundedSet<string>(2);
        s.add('a');
        s.add('b');
        s.add('c'); // supera il cap → evince 'a'
        expect(s.size).toBe(2);
        expect(s.has('a')).toBe(false);
        expect(s.has('b')).toBe(true);
        expect(s.has('c')).toBe(true);
    });

    it('re-add di un valore già presente non altera il cap', () => {
        const s = new BoundedSet<string>(2);
        s.add('a');
        s.add('b');
        s.add('a'); // già presente: nessuna eviction
        expect(s.size).toBe(2);
        expect(s.has('a')).toBe(true);
        expect(s.has('b')).toBe(true);
    });
});
