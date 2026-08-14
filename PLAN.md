# PLAN — F-CB.10: dichiarare gli account al Control Plane (D2 + D1)

> Piano da sottoporre a review avversariale PRIMA di qualunque edit. Auto-contenuto: chi legge non ha
> il contesto della sessione. **Obiettivo della review: demolirlo.** Ogni sezione «⚔️ ATTACCA QUI»
> segnala un punto dove sospetto una debolezza mia — ma non limitarti a quelli.

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
| La tabella cloud `accounts` **esiste ed è VUOTA (0 righe)** | probe read-only sul progetto Supabase vivo (`select` con `count: 'exact', head: true`) |
| Sul cloud `leads` ha 309 righe, `salesnav_list_members` 119, `cp_events` 2, `campaigns` **0** | stesso probe |
| Nel codice ci sono **esattamente 2** punti di contatto con `accounts`: `supabaseDataClient.ts:69` (UPDATE) e `:872` (SELECT). **Zero insert, zero upsert** | `grep` su tutto `src/` |
| **Nel DB locale la tabella `accounts` NON ESISTE** | letto `sqlite_master` sul DB vivo: 57 tabelle, presenti solo `account_incidents` (6 righe) e `account_health_snapshots` (0); **zero `CREATE TABLE accounts`** nelle 73 migration |
| L'identità di un account è **config-driven, non persistita** | `src/accountManager.ts:105` `getRuntimeAccountProfiles()` legge i profili dalla config e, se non ce ne sono, **sintetizza al volo** `{id:'default', sessionDir: config.sessionDir, …}` |
| Lo stato **locale** di quarantena vive nei runtime flag della tabella `sync_state` | `src/core/repositories/system.ts:593` `getQuarantineStatus()` fa `SELECT key FROM sync_state WHERE key LIKE '<ACCOUNT_QUARANTINE_FLAG>:%'`; scrittura via `setAccountQuarantine` |

### Schema REALE della tabella cloud `accounts` (letto via OpenAPI di PostgREST, HTTP 200)

```
id                  text        NOT NULL  [PK]
email               text
display_name        text
session_dir         text
proxy_url           text
tier                text        NOT NULL  default 'WARM_UP'
health              text        NOT NULL  default 'GREEN'
daily_invite_cap    integer     NOT NULL  default 15
daily_message_cap   integer     NOT NULL  default 20
daily_invites_sent  integer     NOT NULL  default 0
daily_messages_sent integer     NOT NULL  default 0
farming_started_at  timestamptz
farming_ends_at     timestamptz
last_active_at      timestamptz
quarantine_reason   text
quarantine_until    timestamptz
metadata            jsonb       NOT NULL  (nessun default esposto)
created_at          timestamptz NOT NULL  default now()
updated_at          timestamptz NOT NULL  default now()
```

🔴 Il tipo TypeScript `CloudAccount` (`src/cloud/types.ts:1-17`) ha **15 campi contro 19 colonne**: gli
mancano `email`, `farming_started_at`, `metadata`, `created_at`. **Un insert costruito dal tipo
fallirebbe** sul NOT NULL di `metadata`.

## 3. I tre difetti

### D1 — nessuno dichiara gli account al cloud (capability mancante)
`updateCloudAccountHealth` (`supabaseDataClient.ts:57`) fa un UPDATE filtrato su `id`. Con la tabella
vuota **colpisce 0 righe**: la quarantena RED decisa da `incidentManager` non arriva mai al Control
Plane. La catena completa:

```
incidentManager.ts:76 (RED) / :163 (YELLOW)
  → resolveAccountId(details)          // :20-26, degrada a 'default' se details.accountId manca
  → cloudBridge.ts:137 bridgeAccountHealth
  → updateCloudAccountHealth           // 0 righe → logWarn 'cloud.accounts.health.update.no_row'
  → (su errore) outbox 'cloud.account.health'
  → supabaseSyncWorker.ts:97           // ri-esegue LO STESSO update a vuoto
```

### D2 — bug LATENTE: il downsync scrive su una tabella locale inesistente
`src/core/repositories/system.ts:1182` `applyCloudAccountUpdates(updates)` esegue
`UPDATE accounts SET … WHERE id = ?` **su una tabella che nel DB locale non esiste** ⇒
`SQLITE_ERROR: no such table: accounts` → throw dentro `withTransaction` → risale a `syncAccountsDown()`.

**Non esplode oggi solo perché** `syncAccountsDown` chiama `applyCloudAccountUpdates` **solo se**
`updates.length > 0`, e il cloud è vuoto **per via di D1**. I due difetti si mascherano a vicenda:
**chiudere D1 per primo accende D2.**

### D3 — silenzio nei rami del sync — ✅ GIÀ CHIUSO (commit `c414f6f`)
`controlPlaneSync.ts` faceva `await Promise.allSettled([syncAccountsDown(), syncLeadsDown(),
syncSalesNavUp()])` senza ispezionare il risultato: `allSettled` non rigetta mai, e due dei tre rami
non hanno try/catch proprio ⇒ i fallimenti sparivano. Ora ogni ramo rigettato esce come
`control_plane.branch.rejected` col proprio nome (predicato puro `ramiFallitiDaEsiti`, 6 test).
**Conseguenza per questo piano**: l'errore di D2, se scattasse, oggi **sarebbe visibile** — resta però
un downsync che non funziona.

## 4. Piano proposto

### Ordine obbligato
**D2 prima di D1.** Motivo: D1 popola la tabella cloud, il che fa passare il gate `updates.length > 0`
e attiva il codice rotto di D2.

### D2 — cosa fare del downsync degli account

Lo stato che il cloud potrebbe rimandare (`health`, `tier`, `quarantine_reason`, `quarantine_until`)
**non ha una destinazione locale in forma di tabella**: in locale la quarantena vive nei runtime flag
di `sync_state`, e tier/health non hanno un consumatore che li legga da una tabella `accounts`.

- **Strada A — mappare sui runtime flag**: `applyCloudAccountUpdates` traduce
  `health === 'RED' || quarantine_until > now` in `setAccountQuarantine(accountId, true/false)`.
  ⇒ È una **capability nuova**: «il Control Plane può mettere in quarantena un account da remoto».
- **Strada B — rimuovere il downsync degli account**: togliere `syncAccountsDown()` dal flusso e la
  funzione `applyCloudAccountUpdates`, dichiarando che il canale cloud→locale per gli account non
  esiste. ⇒ Rimuove una capability **dichiarata ma mai funzionante**.
- **Strada C — fail-loud esplicito**: sostituire l'UPDATE con un log di errore «destinazione locale
  assente» senza toccare il DB. ⇒ Non rimuove nulla, ma congela lo stato attuale rendendolo onesto.

**Proposta: Strada A**, perché è l'unica che rende vero ciò che il sistema già dichiara (esiste un
topic outbox `cloud.account.health`, esiste il downsync, esiste `fetchCloudAccountsUpdates`): B e C
lasciano il Control Plane a metà, capace di ricevere ma non di comandare.

⚔️ **ATTACCA QUI (1)**: la Strada A introduce un **comando remoto che ferma il bot**. Rischi da
demolire: ① un record cloud corrotto o un `health` sbagliato mette in quarantena l'account e **blocca
l'operatività** senza che nessuno in locale l'abbia deciso; ② chi rilascia la quarantena? Oggi
`setQuarantine(false)` esiste **solo come azione manuale**, nessun TTL; ③ il downsync è idempotente ma
**ripetuto**: se un operatore rilascia in locale e il cloud ha ancora `health='RED'`, il giro dopo
rimette la quarantena — **loop di ri-quarantena**. È un difetto reale del mio piano? Come si risolve
senza inventare un altro meccanismo?

### D1 — proiettare i profili verso il cloud

**Architettura scelta: A2** — una funzione `syncAccountsUp()` dentro `runControlPlaneSync`, accanto a
`syncAccountsDown()`, che proietta i profili di `getRuntimeAccountProfiles()` sulla tabella cloud
`accounts` con un **upsert su `id`**, protetta da un **hash-gate** come già si fa per le campagne
(`computeControlPlaneHash`): si scrive solo quando l'insieme dei profili cambia.

**Payload proposto (esplicitamente ristretto):**

```ts
{
  id,                          // dal profilo: chiave di conflitto
  display_name: profile.id,    // nessun dato personale
  metadata: {},                // OBBLIGATORIO: NOT NULL senza default
  updated_at: new Date().toISOString(),
}
```

**Colonne deliberatamente NON inviate e perché:**

| Colonna | Motivo dell'esclusione |
|---|---|
| `email` | **PII** — decisione «zero PII al cloud» |
| `proxy_url` | **SEGRETO** — contiene `user:pass@host` (cfr. `accountManager.ts` `parseProxyConfig`) |
| `session_dir` | percorso locale della macchina: leak d'ambiente, inutile al Control Plane |
| `health`, `tier` | **posseduti dal cloud** (li scrive `updateCloudAccountHealth`); ometterli evita di sovrascriverli |
| `daily_*_cap`, `daily_*_sent` | **contatori posseduti dal cloud**: rimandarli li azzererebbe |

**Base tecnica dell'omissione** (verificata sul client installato,
`node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts:1341-1400`): `upsert` invia
`Prefer: resolution=merge-duplicates`, quindi sul conflitto l'UPDATE tocca **solo le colonne presenti
nel payload**. Il docstring `:1165-1168` conferma che `defaultToNull` riguarda solo l'INSERT di righe
nuove, non il merge.

**Alternative scartate:**
- **A1 — proiezione all'avvio del bot**: la divergenza dura quanto l'uptime; se la riga viene
  cancellata sul cloud non torna mai.
- **A3 — creazione lazy dentro `updateCloudAccountHealth` quando `count === 0`**: fonde «dichiarare
  l'identità» con «aggiornare lo stato» dentro un fix di error-handling; e soprattutto
  `resolveAccountId` può passare un `'default'` **inventato** (quando l'incident non porta un
  accountId) ⇒ creerebbe **righe fantasma** da un id di fallback.

⚔️ **ATTACCA QUI (2) — la deprovisioning, che il mio piano NON copre.** Se un profilo viene **rimosso
dalla config**, la sua riga resta sul cloud per sempre: il Control Plane mostrerà un account che non
esiste più, e il downsync continuerà a riceverlo. Le opzioni che vedo — cancellare le righe non più
presenti (pericoloso: una config temporaneamente vuota **cancellerebbe tutto**), marcarle inattive
(serve una colonna che **non c'è** nello schema), o non fare nulla e dichiararlo — non mi convincono.
Qual è la forma giusta?

⚔️ **ATTACCA QUI (3) — l'id `'default'` sintetizzato.** Quando la config non ha profili,
`getRuntimeAccountProfiles()` **inventa** `{id:'default'}`. Il mio piano lo proietterebbe come un
account vero. È corretto (esiste davvero un bot che gira con quel profilo) o sto creando una riga per
qualcosa che è solo un fallback? E come si distingue dal `'default'` **inventato da
`resolveAccountId`**, che invece considero illegittimo?

⚔️ **ATTACCA QUI (4) — l'hash-gate.** Su cosa si calcola l'hash? Se sull'insieme degli `id`, un
cambiamento di `display_name` non verrebbe mai propagato. Se su tutto il profilo, si riscrive a ogni
modifica irrilevante. E se la riga viene cancellata **sul cloud** mentre l'hash locale non cambia, la
proiezione **non si auto-ripara** — il che distrugge la ragione stessa per cui ho scelto A2 su A1.

⚔️ **ATTACCA QUI (5) — concorrenza e ordine.** `syncAccountsUp()` e `syncAccountsDown()` girerebbero
nello stesso `Promise.allSettled`, quindi **in parallelo**: l'up potrebbe scrivere mentre il down
legge, con `updated_at` che si muove sotto i piedi del cursore `lastSyncAt`. Va serializzato? E il
cursore `control_plane.accounts.last_sync_at` rischia di **saltare le proprie scritture** o di
rileggerle in loop?

## 5. Criteri di accettazione (in parole d'uso)

1. Se il bot va in quarantena, il Control Plane lo vede.
2. Se qualcosa nella catena verso il cloud si rompe, compare nei log.
3. Il cloud non perde i conteggi giornalieri quando il bot si ri-dichiara.
4. Nel cloud non finiscono password del proxy, email o percorsi del PC.
5. Il bot non crea account fantasma: solo quelli realmente configurati.
6. Il bot non può essere fermato da uno stato cloud sbagliato senza che sia visibile e reversibile.

## 6. Vincoli di progetto non negoziabili

- **Anti-ban prima di tutto**: nessun file sotto `src/browser/**`, `src/risk/**`, `src/salesnav/**`,
  `src/captcha/**`, `src/workers/**` va toccato senza review dedicata. Il piano attuale **non** li
  tocca — se la review propone una soluzione che li tocca, va dichiarato.
- Quality gate: `npm run conta-problemi` (typecheck + lint + test) deve uscire **0**, e per modifiche
  a `src/` va eseguito anche `npm run build:backend` (il bot esegue `dist/`).
- Ogni fix di questa classe richiede un **rosso di controllo**: il test deve fallire *prima* del fix.
