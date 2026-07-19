# sec5 — Password proxy non più persistita in chiaro in `.session-meta.json`

> Binding per `/goal sec5`. Origine: backend-audit SEC5-parte1 (`~/todos/backend-audit-2026-06-06.md`).
> Ricerca read-only completata 2026-06-13 (fonte reale `src/proxyManager.ts`, non assunzioni).

## End-state misurabile

`persistStickyProxy` NON scrive più `password` (né `username`) in chiaro in `.session-meta.json`; `loadPersistedStickyProxy`+`getStickyProxy` ri-derivano le credenziali dal **pool** (config, `loadProxyPool()`) matchando il proxy persistito. Lo sticky proxy resta INVARIATO (stesso IP riusato tra riavvii nella stessa settimana). `npm run conta-problemi` exit 0; `/antiban-review` SICURO (nessun cambio a stickiness/geo-coerenza/rotazione).

## Quadro verificato (evidenza, `src/proxyManager.ts`)

- **Save** `persistStickyProxy:687-706`: scrive `meta.stickyProxy = { server, username, password, type, weekNumber }` → **password in chiaro riga 698** (+ username riga 697).
- **Load** `loadPersistedStickyProxy:668-685`: rilegge tutto e ricostruisce `{ server, username, password, type }` + weekNumber dal file.
- **Uso** `getStickyProxy:708-757`: se sessione non in memoria + sessionDir → carica persistito; riusa SOLO se `weekNumber === week` corrente E `loadProxyPool().some(p => p.server === persisted.proxy.server)` (`stillInPool:721`). Alloca nuovo da `getProxyAsync` (dal pool) se non riusabile.
- **Lo sticky proxy È una entry del pool** (`getProxyAsync:752`), NON un proxy con sessid runtime → server+username+password sono ri-derivabili dal pool. La password nel file è ridondante.
- **Pool** (`loadProxyPool:172` → `loadProxiesFromList:142` / single `config.proxyUrl`): credenziali per-riga `host:port:user:pass` OPPURE globali `config.proxyUsername/proxyPassword` via `applyGlobalCredentials:115`. `proxyKey:127` distingue per `server|username|password`.
- **Unico writer/reader della password nel file = proxyManager.ts.** I reader in `launcher.ts:273`/`proxyLaunchPlan.ts` usano l'oggetto runtime (da getStickyProxy), non il file. Blast radius = proxyManager.ts.
- `ProxyConfig` = `src/proxy/types.ts:9` (server, username?, password?, type).

## Design (regression-safe + anti-ban-safe)

Match per **server+username** (preciso anche con credenziali per-riga), fallback **solo server** (caso credenziali globali, username uguale per tutti); password SEMPRE dal pool, MAI dal file. Retro-compatibile: il load ignora la password dei file vecchi (la prende dal pool), il primo re-persist riscrive `meta.stickyProxy` ripulendo il segreto.

## Stato: ✅ CODICE DONE+COMMITTATO `8488173` (2026-06-13)
T1-T4 chiusi. Gate verde (conta-problemi exit 0, vitest 1761/1761, +7). antiban-review SICURO. Push = leva utente (anti-ban). **Decisione di design rifinita vs binding**: TENUTO `username` nel file (rimossa solo `password`) + match ESATTO server+username (no fallback solo-server) → su gateway Oxylabs condiviso l'username porta sessione/geo, un match solo-server riuserebbe un IP diverso = regressione anti-ban.

## Task

- [x] **T1 — proxyManager.ts** (DONE): persistStickyProxy salva solo server+username+type+weekNumber (no password); loadPersistedStickyProxy ritorna `PersistedStickyProxy` (no password); getStickyProxy match esatto nel pool; entrambe `export`. Typecheck exit 0.
  - (a) `persistStickyProxy`: scrivere solo `{ server, type, weekNumber }` — rimuovere `username` e `password` (segreti). [Decisione: rimuovo anche username — è ri-derivabile dal pool e può contenere customer-id; se il match solo-server risultasse ambiguo in T2 ripiego su tenere `username` non-segreto. Verificare in T2 con un pool a server duplicati.]
  - (b) `loadPersistedStickyProxy`: ritornare `{ server, type, weekNumber }` (no credenziali dal file); tipo aggiornato.
  - (c) `getStickyProxy`: sostituire `stickyProxySessions.set(sessionId, persisted.proxy)` con il match nel pool — `pool.find(p => p.server === persisted.server)` (eventualmente raffinato con type) → usa QUEL proxy (credenziali fresche dal config). Nessun match → non riusare (= `stillInPool=false` oggi: alloca nuovo).
  - (d) esportare `persistStickyProxy`/`loadPersistedStickyProxy` per il test (pattern `computeProxyCooldownMs` "estratta come funzione pura testabile + esportata").
  - DONE: nessuna credenziale scritta nel file; credenziali ri-derivate dal pool. VERIFY: typecheck + test T2.
- [x] **T2 — test** (DONE, 7/7) `src/tests/proxyStickyPersist.vitest.ts` (tmpdir reale o mock fs): (a) `persistStickyProxy` scrive un file SENZA `password` (e senza `username`); (b) `loadPersistedStickyProxy` ritorna server/type/weekNumber, NON la password; (c) round-trip via pool: persist → load → match pool → ProxyConfig con password = quella del config/pool (non del file); (d) server NON nel pool → no riuso. Se (a) con pool a server duplicati mostra ambiguità → rivedere T1a (tenere username). VERIFY: `npx vitest run src/tests/proxyStickyPersist.vitest.ts` verde.
- [x] **T3 — gate + antiban** (DONE): `npm run conta-problemi` exit 0 (1761 test) + `/antiban-review` SICURO (atteso SICURO: nessun cambio a stickiness/geo/rotazione; solo niente-segreto-su-disco + credenziali fresche dal config).
- [x] **T4 — chiusura** (DONE): commit `8488173`; SEC5-parte1 spuntato in `backend-audit-2026-06-06.md` (anti-ban/SEC 6/6 codice chiuso); worklog + active.md aggiornati. Push = leva utente.

## Fuori scope (leva utente, NON in questo goal)

- **SEC5-parte2**: lookup ASN su `http://` (`proxyQualityChecker.ts:210`) → MITM può spoofare DC→residential. Fix = ip-api su HTTPS, richiede **piano provider Pro** = leva utente. Tracciato in backend-audit + `user-actions-pending.md`.

## Constraint

- Anti-ban first: lo sticky proxy garantisce stesso-IP-per-sessione (geo-coerenza, no cambi IP anomali). Il fix NON deve cambiare QUALE IP viene riusato — solo DA DOVE arrivano le credenziali (pool/config invece del file). Se la ri-derivazione desse un proxy diverso → regressione anti-ban CRITICA.
- Regression-safe (zero-Q): baseline test verdi prima; round-trip persist→load→stesso-proxy verificato nel test.
- Sicurezza (L6.7): credenziali mai loggate, mai su disco in chiaro.
