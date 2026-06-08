/**
 * utils/boundedCache.ts
 * ─────────────────────────────────────────────────────────────────
 * Cache in-memory con tetto massimo di voci ed eviction automatica,
 * drop-in per `Map`/`Set`. Consolida il pattern di eviction prima
 * presente solo inline in `SemanticChecker.evictLeadsIfNeeded`.
 *
 * Motivazione: diverse cache module-level negli enrichment (mxCache,
 * domainCache, companyCache, port25BlockedCache) crescono illimitate per
 * tutta la vita del processo. Su run lunghi (giorni) = slow memory leak.
 * Zero dipendenze esterne, coerente con la filosofia dei moduli integrations.
 */

const DEFAULT_MAX_ENTRIES = 1000;

function normalizeCap(maxEntries: number): number {
    return Math.max(1, Math.floor(maxEntries));
}

/**
 * Map con tetto massimo di chiavi ed eviction LRU (least-recently-used).
 * Drop-in per `Map`: stessa API `get`/`set`/`has`/`delete`. Su `get` di una
 * chiave presente la promuove a most-recently-used; su `set` oltre il cap
 * rimuove la chiave meno recentemente usata. Conserva i valori `null`/`undefined`
 * (l'assenza si distingue solo via `has`).
 */
export class BoundedMap<K, V> {
    private readonly map = new Map<K, V>();
    private readonly maxEntries: number;

    constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
        this.maxEntries = normalizeCap(maxEntries);
    }

    get size(): number {
        return this.map.size;
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    get(key: K): V | undefined {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key) as V;
        // Promuovi a most-recently-used: re-inserisci in coda all'ordine di iterazione.
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }

    set(key: K, value: V): this {
        if (this.map.has(key)) {
            this.map.delete(key); // refresh recency: re-inserisci in coda
        } else if (this.map.size >= this.maxEntries) {
            // Evict il least-recently-used = la prima chiave in ordine di iterazione.
            const oldest = this.map.keys().next();
            if (!oldest.done) this.map.delete(oldest.value);
        }
        this.map.set(key, value);
        return this;
    }

    delete(key: K): boolean {
        return this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }
}

/**
 * Set con tetto massimo di voci ed eviction FIFO (il più vecchio inserito esce
 * per primo). Drop-in per `Set`: API `has`/`add`/`delete`. La recency non conta
 * per l'uso previsto (es. domini con porta 25 bloccata, stato permanente nella
 * sessione): serve solo impedire la crescita illimitata.
 */
export class BoundedSet<T> {
    private readonly set = new Set<T>();
    private readonly maxEntries: number;

    constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
        this.maxEntries = normalizeCap(maxEntries);
    }

    get size(): number {
        return this.set.size;
    }

    has(value: T): boolean {
        return this.set.has(value);
    }

    add(value: T): this {
        if (this.set.has(value)) return this;
        if (this.set.size >= this.maxEntries) {
            const oldest = this.set.values().next();
            if (!oldest.done) this.set.delete(oldest.value);
        }
        this.set.add(value);
        return this;
    }

    delete(value: T): boolean {
        return this.set.delete(value);
    }

    clear(): void {
        this.set.clear();
    }
}
