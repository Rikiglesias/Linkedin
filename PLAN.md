# PLAN — F-CB.10: dichiarare gli account al Control Plane (D2 + D1)

> **Versione RATIFICATA (2026-08-15).** Sostituisce il piano bocciato dal gate ④ (commit `d8799e0`).
> Il *perché* di ogni decisione — con le premesse false smontate una a una — vive in
> **`PLAN-REVIEW-VERDICT.md`** (commit `9d5efaf`): qui non si ricopia, si punta.
> Questo file è il **cosa si fa**, nell'ordine in cui si fa, col rosso di controllo di ogni passo.

**Verdetto del gate ④**: `REVISE` su due canali indipendenti (Codex cross-model, 8 obiezioni
bloccanti · Workflow a 6 lenti + 3 refutatori per finding, 118 agenti). La **Strada A è respinta**:
dava autorità di comando a una tabella senza comandante, e con un solo account configurato avrebbe
**spento il fail-safe globale di quarantena** dopo un CHALLENGE. Rotta approvata: **D2 = B+**, poi
**D1 con 6 correzioni**.

## 1. Il sistema, in breve

Bot LinkedIn (TypeScript, Node) con database **locale SQLite** (`data/linkedin_bot.sqlite`, 57 tabelle,
73 migration in `src/db/migrations/`). Un **Control Plane** opzionale su **Supabase/Postgres** riceve
dati dal bot e può rimandare configurazione. Il ponte è `src/cloud/` +
`src/sync/supabaseSyncWorker.ts`, con una **outbox** locale per il retry (5 topic:
`cloud.lead.upsert|status|erase`, `cloud.account.health`, `cloud.daily_stat`).

La sincronizzazione gira dentro `runControlPlaneSync()` (`src/cloud/controlPlaneSync.ts`), invocata dal
loop del bot (`src/cli/commands/loopCommand.ts:353`) a intervalli configurati.

## 2. Fatti accertati alla fonte (evidenza, non memoria)

| Fatto | Come è stato verificato |
|---|---|
| Nel codice ci sono **esattamente 2** punti di contatto con `accounts`: `supabaseDataClient.ts:69` (UPDATE) e `:872` (SELECT). **Zero insert, zero upsert** | `grep` su tutto `src/` |
| **Nel DB locale la tabella `accounts` NON ESISTE** | letto `sqlite_master` sul DB vivo: 57 tabelle, presenti solo `account_incidents` (6 righe) e `account_health_snapshots` (0); **zero `CREATE TABLE accounts`** nelle 73 migration |
| L'identità di un account è **config-driven, non persistita** | `src/accountManager.ts:105` `getRuntimeAccountProfiles()` legge i profili dalla config e, se non ce ne sono, **sintetizza al volo** `{id:'default', sessionDir: config.sessionDir, …}` |
| Lo stato **locale** di quarantena vive nei runtime flag della tabella `sync_state` | `src/core/repositories/system.ts:593` `getQuarantineStatus()` fa `SELECT key FROM sync_state WHERE key LIKE '<ACCOUNT_QUARANTINE_FLAG>:%'`; scrittura via `setAccountQuarantine` |
| Con **un solo** profilo configurato `MULTI_ACCOUNT_ENABLED` è **false** (`config/domains.ts:86`) ⇒ il runtime degrada al sintetico `{id:'default'}` (`accountManager.ts:105-120`), e `setAccountQuarantine('default', …)` scrive il **flag GLOBALE** che blocca/sblocca **ogni** account (`system.ts:558-581`) | letto riga per riga durante il gate ④ |
| Nessun percorso di produzione scrive mai `GREEN` verso il cloud: solo `incidentManager.ts:76` (RED) e `:163` (YELLOW). `tier` non lo scrive nessuno | `grep` su `src/` |

### Schema REALE della tabella cloud `accounts` — **ri-misurato dal vivo il 2026-08-15**

Probe read-only sul progetto Supabase vivo (host verificato, project-ref non riportato): `HEAD` con
`Prefer: count=exact` per i conteggi, OpenAPI di PostgREST (`/rest/v1/`, HTTP 200) per colonne e FK.
Chiude il §6 del verdetto («premesse ancora assunte»).

| Misura | Valore |
|---|---|
| `accounts` | HTTP 200, **0 righe** (`content-range: */0`), 19 colonne, PK `id` text |
| `daily_stats_cloud` | 0 righe · `account_id` **FK → accounts.id** |
| `jobs_cloud` | 0 righe · `account_id` **FK → accounts.id** |
| `telegram_commands` | 0 righe · `account_id` **FK → accounts.id** |
| `cp_events` | 2 righe |
| `daily_stats`, `jobs` (senza `_cloud`) | **HTTP 404 — non esistono sul cloud** |
| Colonne con default esposto | `tier='WARM_UP'`, `health='GREEN'`, `daily_invite_cap=15`, `daily_message_cap=20`, `daily_*_sent=0`, `created_at/updated_at=now()` |
| `metadata` jsonb | `required` (NOT NULL) — **default NON esposto**: l'OpenAPI è cieco sui default jsonb (0 su tutte le colonne jsonb, `payload` inclusa) |

**Tre conseguenze:**

1. 🔴 **Le FK sono tre, non due.** Il verdetto ne citava due; `telegram_commands.account_id` è la
   terza. Poiché B+ elegge `telegram_commands` a canale-comando corretto per il futuro, quel canale
   **non può funzionare finché `accounts` è vuota**: un comando con `account_id` valorizzato muore in
   **23503**. L'ordine non cambia (D2 prima resta giusto: rimuove la mina), cambia il valore di D1 —
   sblocca **tre** canali, incluso il successore designato.
2. **Il default di `metadata` resta non misurabile read-only** e lo è per costruzione: l'OpenAPI non
   lo espone e la tabella ha 0 righe, quindi non esiste la prova empirica che chiuse il caso analogo
   su `leads`. **Neutralizzato per DESIGN**: la correzione ③ impone di passare `metadata` **sempre**,
   in insert e in merge ⇒ il default è irrilevante alla correttezza. Residuo dichiarato, non silente.
3. L'anomalia annotata in precedenza («`daily_stats` ritorna `count=null`») era una **tabella
   inesistente** (404), non un difetto di conteggio. Voce corretta.

## 3. I tre difetti

### D3 — silenzio nei rami del sync — ✅ **CHIUSO** (commit `c414f6f`)
`Promise.allSettled` non rigetta mai e due rami su tre non avevano try/catch proprio ⇒ il downsync
poteva fallire a ogni ciclo senza una riga di log. Ora ogni ramo rigettato esce come
`control_plane.branch.rejected` col proprio nome (predicato puro `ramiFallitiDaEsiti`, 6 test).

### D2 — il downsync scrive su una tabella locale che non esiste
`system.ts:1182` `applyCloudAccountUpdates` fa `UPDATE accounts` su una tabella **assente dal DB
locale**. Inerte **solo perché** il cloud è vuoto (cioè per via di D1) ⇒ **chiudere D1 per primo
l'avrebbe accesa**. La destinazione è sbagliata a prescindere: lo stato locale vive in `sync_state`.

### D1 — nessuno dichiara gli account al cloud (capability mancante)
`accounts` esiste, nessun percorso la popola. Conseguenze misurate: la quarantena RED non raggiunge
mai il Control Plane (l'UPDATE trova 0 righe, **non lancia**, nessun outbox) e le tre FK sopra
restano bloccate.

## 4. Ordine di implementazione ratificato — 7 passi

Gate di chiusura di **ogni** passo: `npm run conta-problemi` a 0 **e** `npm run build:backend`
(il bot esegue `dist/`). Ogni passo ha un **rosso di controllo**: il test fallisce *prima* del fix.

### Passo 0 — de-posizionalizzare il registro dei rami *(prerequisito, non abbellimento)*
`NOMI_RAMI_SYNC` (`controlPlaneSync.ts:24`) è un array separato dalle promise di `:226`, tenuto in
sincrono da un commento. Rimuovere un ramo **rinomina gli altri**: `leads_down` uscirebbe etichettato
`accounts_down`. Struttura unica `const RAMI = [{nome, esegui}]` da cui derivano sia i nomi sia
`Promise.allSettled(RAMI.map(r => r.esegui()))`.
> **Rosso**: test che rimuove il primo elemento del registro e asserisce che i rimanenti restano
> `['leads_down','salesnav_up']`. Contro l'array posizionale odierno torna `['accounts_down','leads_down']`
> → FAIL. I 6 test attuali provano solo il predicato puro e resterebbero verdi: **quello è il punto**.

### Passo 1 — D2 = Strada B+
Rimuovere la catena downsync: `syncAccountsDown`, `applyCloudAccountUpdates`,
`fetchCloudAccountsUpdates`, il flag del cursore. **Un solo chiamante per funzione, 3 file, nessuno
nel glob anti-ban.** Più il commento stantio e una nota che dichiara il canale corretto per il futuro:
**`telegram_commands`** (per-account, one-shot, consumato ⇒ non può oscillare) con tre precondizioni
da scrivere nel codice quando nascerà — **monotono-restrittivo** (il remoto può solo IMPORRE uno stop,
mai rilasciarlo), **allow-list** sugli id, **`'default'` rifiutato per costruzione**.

*zero-Q col metro del comportamento*: oggi quel ramo consegna **zero capability** — può solo lanciare
`no such table`, e se non lanciasse scriverebbe colonne che **nessun gate legge** (i gate leggono i
runtime flag di `sync_state`). Dopo B+ il sistema fa ≥ di prima, con una mina in meno.
> **Rosso**: (a) test sul registro che asserisce **2** rami, `['leads_down','salesnav_up']` → FAIL oggi
> (3); (b) **sentinella di repo**: `grep` in `src/` di `UPDATE accounts` e `from('accounts').select`
> attesi a **0** → FAIL oggi (2 hit). La (b) impedisce il ritorno del ramo per inerzia.

### Passo 2 — probe dello schema cloud vivo — ✅ **ESEGUITO 2026-08-15**
Non è un edit, è un gate. Esito nella tabella del §2: FK confermate (e una terza trovata), `accounts`
a 0 righe **oggi**, default di `metadata` chiuso per design. **Il passo 3 è sbloccato.**

### Passo 3 — D1, costruttore di payload **puro**
`costruisciProiezioneAccount(profili, statoQuarantenaLocale)` estratto puro (stessa lezione di
`ramiFallitiDaEsiti`: la regola si prova, il wiring si legge).

**Payload — allow-list letterale, mai per sottrazione.** Un `{...profile, id}` porterebbe
`profile.proxy.password` e nessuna tabella di esclusioni lo intercetterebbe: serve il test, non la
disciplina.

| Campo | Decisione |
|---|---|
| `id` | proiettato. `'default'` **incluso** — ma solo perché si è scelta B: sotto B è inerte, ed è il **genitore FK** che serve alle tre tabelle. Se mai nascerà un canale cloud→locale, `'default'` (e ogni id che normalizza a `'default'`: vuoto, whitespace) va escluso **prima di qualunque altra cosa** |
| `display_name` | proiettato |
| `health` | **incluso, derivato dallo stato LOCALE** (`getQuarantineStatus()`, `system.ts:593`). Ometterlo lascia decidere `'GREEN'` al default nell'INSERT: una riga che dice GREEN mentre il bot è in quarantena viola il criterio 1 **nel momento in cui la capability nasce** |
| `metadata` | `{ bot: { declared_by: 'bot', last_declared_at: <iso>, schema: 1 } }`. **Mai `{}`**: il merge PostgREST sostituisce l'intero jsonb ⇒ `{}` è una cancellazione ripetuta. Il top-level `bot` rende il bot proprietario **dichiarato** e contiene un futuro merge. Vincolo da scrivere nel codice: vale finché il bot è l'unico scrittore |
| `updated_at` | **non inviato**. Lo possiede il DB (`default now()` + trigger). Una proiezione d'identità non tocca il campo-tempo di qualcun altro |
| `email`, `proxy_url`, `session_dir` | **mai proiettati** — PII, segreti (`user:pass@host`), leak d'ambiente |
| `tier`, `daily_*_cap`, `daily_*_sent` | **mai rimandati**: sono stato posseduto dal cloud, un upsert li azzererebbe |

> **Rosso** — quattro asserzioni che falliscono oggi (la funzione non esiste) e fallirebbero anche
> contro il payload bocciato: (a) un profilo con `proxy:{username,password}` non fa comparire la
> password nel `JSON.stringify` del record — è il rosso del criterio 4 e la sentinella contro
> `{...profile}`; (b) le chiavi sono **esattamente** `{id, display_name, health, metadata}`;
> (c) con quarantena locale attiva `health === 'RED'` (il payload bocciato ometteva `health` → FAIL);
> (d) `metadata.bot.declared_by === 'bot'` (contro `{}` → FAIL).

**Deprovisioning — la proiezione è ADDITIVA, non un censimento.** Non dichiara «questi sono TUTTI
gli account», dichiara «questi esistono». La liveness si legge da `metadata.bot.last_declared_at`.
**Mai dedurre una cancellazione da un'assenza**: tre percorsi verificati producono una lista vuota o
parziale senza che la config cambi (`--account` con typo → `[]` a `accountManager.ts:96-101`, `.env`
non caricato, `ACCOUNT_n_SESSION_DIR` mancante), e un reconcile-by-delete cancellerebbe a cascata
`daily_stats_cloud`/`jobs_cloud` e azzererebbe `telegram_commands.account_id` (`on delete set null`
⇒ il poll `.eq('account_id', id)` non li trova più: **canale di controllo muto senza errori**).
Il ritiro è un atto esplicito e locale, **fuori da questo lavoro, dichiarato come residuo**.

### Passo 4 — gate di proiezione + leader gate
`deveProiettare(hashPrec, hashNuovo, ultimaProiezioneAt, now)` puro.
- **Hash sul payload serializzato** (array ordinato per id), non sugli id e non sul profilo intero:
  ciò che cambia lo scritto propaga, ciò che non lo cambia non scrive.
- **Pavimento temporale 24h**: ri-proiettare comunque se l'ultima proiezione riuscita è più vecchia
  di 24h, a hash invariato. Chiude il caso «riga cancellata sul cloud» con il pattern runtime-flag
  già in casa, nessuna primitiva nuova.
- **Leader gate, obbligatorio**: `control_plane_sync` è l'unico task periodico **senza**
  `!ctx.isLeader` (`loopCommand.ts:350-352`, contro `:528,:544,:587,:605,:623`). Oggi è innocuo
  perché l'hash è calcolato sulle campagne, uguale per tutti i processi. **D1 lo rende dannoso**:
  l'hash degli account dipende da `getRuntimeAccountProfiles()`, che sotto `--account X` vale `[X]`
  ⇒ due processi si riscriverebbero l'hash a vicenda a ogni ciclo, e l'unica cosa che tiene basso il
  volume di scritture smetterebbe di tenere.
> **Rosso**: (a) hash uguale + ultima proiezione **oltre 24h** → attesa `true`; con un hash-gate
> semplice torna `false` → FAIL; (b) hash uguale + proiezione recente → `false`; (c) `shouldRun` di
> `control_plane_sync` torna `false` con `isLeader:false` → FAIL oggi.

### Passo 5 — chiudere il buco di bootstrap su `no_row` *(solo DOPO 3 e 4, mai prima)*
`updateCloudAccountHealth` con `count===0` oggi logga e **ritorna senza lanciare**
(`supabaseDataClient.ts:74-83`): il `.catch` di `bridgeAccountHealth` non scatta ⇒ **nessun outbox,
nessun retry, la RED è persa per sempre**. La giustificazione scritta nel commento («un mismatch di
identità non si risolve ritentando») **decade con D1**: con la proiezione attiva la riga arriva,
quindi il retry ha senso. Correzione: `throw` **solo se** l'id è in `getRuntimeAccountProfiles()`;
id sconosciuto → resta `logWarn` (fail-closed sul rumore, niente DLQ per id fantasma).
> **Rosso**: client mockato che ritorna `count:0` per un id **configurato** → `updateCloudAccountHealth`
> lancia e `bridgeAccountHealth` deposita `cloud.account.health` in outbox → FAIL oggi. Il caso
> `account-mai-creato` di `cloudWriteContract.vitest.ts` va **invertito nello stesso commit** che
> cambia il contratto: l'inversione è la prova visibile del cambio, non un test aggiustato per il verde.
> **Worst-case dichiarato**: un id configurato ma mai proiettabile spinge fino alla DLQ in ~64 min
> (`15s · 2^(n-1)`, 8 tentativi) con **un** alert Telegram critical. Limitato, e nel verso giusto.

### Passo 6 — redazione di `cp_events`
`supabaseSyncWorker.ts:213-222` redige **un solo topic** (`cloud.lead.erase`); tutto il resto finisce
nel DB di terze parti **verbatim**, mentre lo stesso oggetto passa per `sanitizeForLogs` verso Telegram
(`incidentManager.ts:71` vs `pushOutboxEvent` a `:55-66`). In transito oggi: URL di checkpoint
LinkedIn, keyword di ricerca, lead completi. **Il criterio 4 non è dichiarabile senza questo: è già
violato da un altro canale.** Applicare `sanitizeForLogs()` al `loggedPayload` in un solo punto —
safe per costruzione, perché `applyOutboxOperation` ha già girato sul payload grezzo.
> **Rosso**: un payload con email + URL LinkedIn arriva al mock di `cp_events` **redatto** → FAIL oggi.

## 5. Criteri di accettazione (in parole d'uso)

1. Se il bot va in quarantena, il Control Plane lo vede — **e se la riga non c'è ancora, il segnale
   non si perde: viene ritentato** (passo 5).
2. Se qualcosa nella catena verso il cloud si rompe, compare nei log **col nome del ramo giusto**
   (passo 0).
3. **Le statistiche giornaliere cloud, oggi bloccate dalla foreign key su una tabella vuota, iniziano
   ad arrivare**; non c'è arretrato da drenare (misurato: 0 eventi `cloud.daily_stat` in outbox) e la
   ri-dichiarazione non azzera nessun contatore.
4. Nel cloud non finiscono password del proxy, email o percorsi del PC — **su nessun canale,
   `cp_events` incluso** (passo 6).
5. Il bot non crea account fantasma: solo profili realmente configurati, e **la proiezione non è mai
   un censimento** (nessuna cancellazione dedotta da un'assenza).
6. **Nessuno stato cloud può fermare né far ripartire il bot**: il canale cloud→locale per gli account
   non esiste, e se verrà costruito potrà solo imporre uno stop, mai rilasciarlo.

## 6. Vincoli di progetto non negoziabili

- **Anti-ban prima di tutto**: nessun file sotto `src/browser/**`, `src/risk/**`, `src/salesnav/**`,
  `src/captcha/**`, `src/workers/**` va toccato senza `antiban-review` dedicata. **B+ e D1 non
  toccano il perimetro e non rinominano né normalizzano alcun id locale** (la Strada A invece
  avrebbe dovuto toccare `src/risk/incidentManager.ts`: uno dei motivi per cui è respinta).
- Quality gate: `npm run conta-problemi` a **0** + `npm run build:backend` per ogni modifica a `src/`.
- Ogni fix di questa classe richiede un **rosso di controllo**: il test fallisce *prima* del fix.
- **Non inventare capability dentro un fix**: il canale di comando remoto si *dichiara*, non si
  costruisce qui.

## 7. Fuori scope, tracciato, NON silente

- 🔴 **P1 anti-ban — più grave di D1/D2, da aprire subito e separatamente.** `launcher.ts:298` fa
  `const accountId = options.accountId ?? sessionDir` e i chiamanti principali (`jobRunner.ts:171-174,
  :220-225`, `workflowEntryGuards.ts:89-96`, `loopCommand.ts:555-560`) **non passano `accountId`**.
  Quel valore seeda **fingerprint e tempo di pressione dei tasti**, e `sessionDir` è risolto su
  `process.cwd()` (`config/domains.ts:85` → `env.ts:154-160`, `path.resolve(process.cwd(), …)` su
  ogni valore non assoluto): spostare la repo o cambiare cwd altera il seme **a parità di cookie
  jar** = segnale di cambio-dispositivo sulla stessa sessione autenticata.
  **Ri-verificato alla fonte il 2026-08-15, con due correzioni al verdetto:**
  ① **il difetto è CONDIZIONALE** — con `SESSION_DIR` impostato a un path *assoluto* nell'`.env` il
  seme è stabile e il sintomo non compare (l'`.env` non è leggibile dall'AI ⇒ stato odierno non
  determinabile da qui); resta latente perché cambiare quel valore muta il fingerprint.
  ② 🔴 **il fix è più rischioso del difetto**: `account.id` è disponibile nelle righe adiacenti di
  `jobRunner`, ma passarlo **cambia fingerprint e dwell di un account già autenticato**, cioè produce
  proprio il segnale «cambio dispositivo» che si vuole evitare. Serve una **migrazione progettata**
  (seme stabile per gli account esistenti, flip solo su sessione nuova), non un fix a reflex.
  ⇒ `antiban-review` dedicata, **task separato**.
- `quarantine_until` cloud ha **semantica sbagliata**: la scrive `pauseAutomation` col `pausedUntil`
  di una pausa WARN. Sotto B nessuno la legge ⇒ non bloccante, ma è una bugia di modellazione che
  morderà il primo che costruisce una dashboard. Tocca `src/risk/**` → tracciare.
- **`'default'` come wildcard locale**: `setAccountQuarantine` reinterpreta `'default'` come «tutti»
  (`system.ts:562-566`). Forma corretta: una chiave che **non è un id** (`account_quarantine:__ALL__`)
  con rifiuto esplicito di `'default'` in ingresso. **Prerequisito bloccante di qualunque futuro
  canale comandi.**
- `setAccountQuarantine` non scrive `security_audit_events`, mentre `setQuarantine` sì
  (`incidentManager.ts:89-104`) e la regola CL12 lo impone (`adminCommands.ts:473-482`). Sotto B
  nessun percorso remoto lo raggiunge ⇒ nota per il canale comandi futuro.
