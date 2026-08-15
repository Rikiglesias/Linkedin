# PLAN-REVIEW — verdetto del gate ④ (F-CB.10)

> Artefatto della review avversariale del `PLAN.md`. **Due canali indipendenti**:
> ① **Codex** cross-model (read-only) → `VERDICT:REVISE`, 8 obiezioni bloccanti.
> ② **Workflow multi-lente** `wf_d94bf2d4-389`: 6 lenti + 3 refutatori per finding grave
> (sopravvivenza a maggioranza 2/3), 118 agenti, 0 errori, 6.6M token, 40 min.
> Sotto: la sintesi dell'architetto sui finding SOPRAVVISSUTI alla refutazione.
> Il giudizio finale resta dell'autore: delegata la raccolta, non il giudizio del gate.

---

## VERDETTO: REVISE — il piano non procede come scritto

Non è un rifiuto della capability: D1 va fatta e vale più di quanto il piano stesso stimi. È il rifiuto della **Strada A** e di 4 dettagli del payload/gate di D1. Sotto c'è la versione approvabile, con ordine e rossi.

Verifiche fatte alla fonte in questa sessione (non ereditate dai findings): `src/core/repositories/system.ts:562-566` e `:572-581`, `:1182-1207` · `src/cloud/supabaseDataClient.ts:56-83`, `:863-877` · `src/risk/incidentManager.ts:20-26,:41,:76,:89-104,:163` · `src/accountManager.ts:87-125` · `src/cloud/cloudBridge.ts:131-149` · `src/cli/commands/loopCommand.ts:350-352` vs `:528,:544` · `src/browser/launcher.ts:298` · `src/sync/supabaseSyncWorker.ts:203-226` · FK a `supabase.full.schema.sql:95,123,181,206,240` · DB locale vivo: **nessun `CREATE TABLE accounts`**, outbox = `incident.opened`(6) + `selector.canary.report`(8), **zero `cloud.daily_stat`**, deliveries 13 PENDING/0 PERMANENT_FAILURE, `sync_state.account_quarantine='false'` · catena downsync = **1 solo chiamante per funzione** (rimozione contenuta a 3 file).

---

## 1. D2 → **Strada B rafforzata (B+)**. A è respinta.

### Perché A è respinta (motivo strutturale, non lista di bug)

Quattro findings indipendenti a 3/3 convergono sullo stesso punto, ma la ragione di fondo è una sola: **Strada A dà autorità di comando a una tabella che non ha un comandante.**

Nessun percorso di produzione scrive mai `'GREEN'` sul cloud: gli unici scrittori sono `incidentManager.ts:76` (RED) e `:163` (YELLOW). Non esiste una dashboard che scriva `accounts`. Quindi, con A attiva, l'unico contenuto informativo che il downsync può leggere sono **le scritture del bot stesso** più i **default del DDL** sulla riga che D1 crea (`health='GREEN'`, `supabase.full.schema.sql:76`). L'omissione di `health` dal payload protegge il merge, **non protegge l'INSERT**.

Da lì il danno è per costruzione, non per corruzione:

- `syncAccountsUp` crea la riga → `health='GREEN'` (default DB) → `syncAccountsDown` la rilegge → A traduce non-RED in `setAccountQuarantine(id, false)`.
- Con `multiAccountEnabled=false` (caso normale) `getRuntimeAccountProfiles()` sintetizza `[{id:'default'}]` (`accountManager.ts:105-125`), e `setAccountQuarantine('default', false)` **non tocca un account: azzera il flag GLOBALE** `account_quarantine` (`system.ts:562-566`), quello che `getAccountQuarantine` fa vincere su ogni id e che `quarantineAccount` usa come fail-safe per incidenti non attribuibili.
- In parallelo `pauseAutomation` scrive `quarantine_until = pausedUntil` (`incidentManager.ts:163` → `supabaseDataClient.ts:66`): quella colonna sul cloud **trasporta la scadenza di una PAUSA WARN**, non una quarantena. La regola `health==='RED' || quarantine_until > now` promuove un 429 con backoff a quarantena **senza TTL** (`setAccountQuarantine` scrive un booleano, niente lo rilascia).
- E `applyCloudAccountUpdates` scrive PRIMA che il cursore avanzi (`controlPlaneSync.ts:119` vs `:127`): un throw congela il canale in loop permanente, non in retry.

Verso anti-ban: il piano ha analizzato solo il falso-stop (⚔️1). Il **falso-rilascio è il rischio grave** — il bot riprende a colpire LinkedIn dopo un CHALLENGE/CAPTCHA/ACCOUNT_RESTRICTED, con l'unica traccia un `control_plane.accounts.downsync {count:1}`. Tie-break liv.1: qui si decide, non si pesa.

Vincolo aggiuntivo che il piano non dichiara: **A fatta correttamente tocca `src/risk/incidentManager.ts`** (per passare da `setQuarantine` con actor/audit invece del setter grezzo — oggi `setAccountQuarantine` non lascia riga in `security_audit_events`, contro la regola CL12 già scritta in `adminCommands.ts:473-482`). Cioè A viola il §6 del piano stesso. **B non tocca nessun file del perimetro anti-ban.**

### Cosa è B+ (non è un'amputazione)

1. Togliere `syncAccountsDown()` dal `Promise.allSettled` (`controlPlaneSync.ts:226`), eliminare `syncAccountsDown`, `applyCloudAccountUpdates` (`system.ts:1182-1207`), `fetchCloudAccountsUpdates` (`supabaseDataClient.ts:863`) e il flag `control_plane.accounts.last_sync_at`. Un solo chiamante ciascuno: rimozione pulita, 3 file, nessuno nel glob anti-ban.
2. Correggere il commento stantio a `supabaseDataClient.ts:78` (cita `fetchCloudAccounts`, funzione inesistente).
3. **Dichiarare il canale corretto per il futuro invece di lasciare un buco**: se un giorno serve davvero un comando remoto, la primitiva giusta esiste già ed è intenzionale — `telegram_commands` (per-account, `PENDING`→processed, one-shot, consumato: non può oscillare né ri-scattare), pollata a `loopCommand.ts:260-310`. Con tre precondizioni scritte nel codice: **monotono-restrittivo** (il remoto può solo imporre, mai rilasciare), **allow-list** sugli id di `getRuntimeAccountProfiles()`, **`'default'` rifiutato per definizione**, e passaggio da `setQuarantine(enabled, accountId)` con `actor='control_plane'` per l'audit.

Così zero-Q è soddisfatta col metro giusto (comportamento, non estetica): oggi quel ramo consegna **zero capability** — può solo lanciare `no such table: accounts`, e se non lanciasse scriverebbe colonne che nessun gate legge (i gate leggono i runtime flag di `sync_state`). Dopo B+ il sistema fa ≥ di prima e ha una landmine in meno.

### Perché non C

C (fail-loud) mantiene la fetch di rete a ogni ciclo, il cast non validato (`select('*') as CloudAccount[]`, nessuna normalizzazione al contrario del ramo gemello campagne a `controlPlaneSync.ts:69-93`) e soprattutto **il cursore**: o non avanza (log identico per sempre, il rumore che F-CB.8 voleva eliminare si converte in disinformazione) o avanza (e allora sta ingoiando, cioè è il silenzio ridipinto). C congela un guasto e lo chiama onestà.

### Worst-case di B+, dichiarato

Si perde la possibilità di fermare un account dalla dashboard Supabase. **Oggi quella possibilità non esiste** (nessun consumer locale legge `accounts.health`) e non è mai esistita. Le leve di stop reali restano tutte: `POST /controls/quarantine`, CLI `unquarantine`/`quarantine`, `telegram_commands`, e il risk engine locale. Se domani la si vuole, va costruita sul canale comandi con le tre precondizioni sopra — che è lavoro in più rispetto ad A, ed è esattamente il punto: A costava poco perché era sbagliata.

---

## 2. D1 — sì, ma payload e hash-gate **non reggono come scritti**

Il valore di D1 è più alto di come il piano lo stima. `daily_stats_cloud.account_id` e `jobs_cloud.account_id` sono `references public.accounts(id)` (`supabase.full.schema.sql:181,:206`): con `accounts` vuota, ogni statistica giornaliera cloud violerebbe la FK 23503, RPC e fallback read-modify-write inclusi. **Misurato**: zero eventi `cloud.daily_stat` in outbox e zero PERMANENT_FAILURE — il canale non è mai partito perché il bot non ha mai completato un invito, quindi **non c'è backlog da drenare** e nessun rischio di flush improvviso. Ma D1 non è "dichiarare l'identità": è **sbloccare due canali**. Il criterio 3 va riscritto.

### Payload — 4 correzioni obbligatorie

| Campo | Piano | Decisione |
|---|---|---|
| `health` | omesso | **includere, derivato dallo stato LOCALE** (`getQuarantineStatus()`, `system.ts:593`). L'omissione lascia decidere il default `'GREEN'` all'INSERT: una riga che dice GREEN mentre il bot è in quarantena è la violazione del criterio 1 nel momento esatto in cui la capability nasce |
| `updated_at` | inviato | **non inviare**. Lo possiede il DB (`default now()` + trigger `set_updated_at` BEFORE UPDATE). Inviarlo mette un clock client dove serve un clock server, e — sotto A — muoveva il cursore di un altro canale. Con B il cursore non c'è più, ma la regola resta: una proiezione d'identità non tocca il campo-tempo di qualcun altro |
| `metadata` | `{}` | `{ bot: { declared_by: 'bot', last_declared_at: <iso>, schema: 1 } }`. Il merge PostgREST sostituisce l'intero jsonb: `{}` sarebbe una cancellazione ripetuta. Riservare il top-level `bot` rende il bot proprietario **dichiarato** e contiene un futuro merge. **Vincolo scritto nel codice**: vale finché il bot è l'unico scrittore; un secondo scrittore richiede jsonb merge |
| `id === 'default'` | proiettato | **proiettarlo — ma solo perché si è scelta B**. Sotto A quella riga è un interruttore generale telecomandabile; sotto B è inerte, ed è il **genitore FK** che serve a `daily_stats_cloud`. Regola da scrivere accanto: se mai nascerà un canale cloud→locale, `'default'` (e ogni id che normalizza a `'default'`: vuoto, whitespace) va escluso per costruzione, prima di qualunque altra cosa |

`email`, `proxy_url`, `session_dir`, `tier`, `daily_*`: esclusioni corrette, motivazioni corrette. Ma vanno espresse come **allow-list letterale** (object literal), mai come sottrazione: un `{...profile, id}` porterebbe `profile.proxy.password` e la tabella delle esclusioni non lo intercetterebbe. Serve il test, non la disciplina.

### Hash-gate — 2 correzioni

- **Su cosa**: sull'**esatto payload serializzato che si spedirebbe** (array ordinato per id), non sull'insieme degli id e non sul profilo intero. Risponde a ⚔️4 in entrambi i versi: ciò che cambia lo scritto propaga, ciò che non lo cambia non scrive.
- **Auto-riparazione** (il buco che ⚔️4 individua correttamente): **pavimento temporale**. Ri-proiettare comunque se l'ultima proiezione riuscita è più vecchia di 24h, a hash invariato. Usa il pattern runtime-flag già in casa, nessuna primitiva nuova, e chiude il caso "riga cancellata sul cloud" che era la ragione per cui A2 batteva A1.
- **Leader gate, obbligatorio**: `control_plane_sync` è l'unico task periodico **senza** `!ctx.isLeader` (`loopCommand.ts:350-352`, contro `:528,:544,:587,:605,:623`). Oggi è innocuo perché l'hash è calcolato sulle **campagne**, uguale per tutti i processi. **D1 lo rende dannoso**: l'hash degli account dipende da `getRuntimeAccountProfiles()`, che sotto `--account X` vale `[X]` — due processi si riscriverebbero l'hash a vicenda a ogni ciclo, e l'unica cosa che tiene basso il volume di scritture smetterebbe di tenere. Aggiungere `|| !ctx.isLeader` allo `shouldRun`.

### Ciclo di vita — deprovisioning

**Non si deduce mai da un'assenza.** Tre percorsi verificati producono una lista vuota o parziale senza che la config cambi: `--account` con typo (`accountManager.ts:96-101` → `[]`), `.env` non caricato, `ACCOUNT_n_SESSION_DIR` mancante. Una reconcile-by-delete su quella lista cancella a cascata `daily_stats_cloud` e `jobs_cloud` e azzera `telegram_commands.account_id` (`on delete set null` → il poll `.eq('account_id', id)` non li trova più: canale di controllo muto senza errori). Cioè violerebbe il criterio 3 del piano stesso.

**Forma corretta: la proiezione è ADDITIVA, non è un censimento.** Non dichiara «questi sono TUTTI gli account che esistono», dichiara «questi esistono». La liveness si legge da `metadata.bot.last_declared_at`: chi guarda il Control Plane distingue un account vivo da uno fermo senza cancellare nulla e senza colonne nuove. Il ritiro è un atto esplicito e locale — **fuori da questo lavoro, dichiarato come residuo**, non silente.

---

## 3. Ordine di implementazione, con il rosso di controllo per passo

L'ordine "D2 prima di D1" del piano **resta corretto e si rafforza**: è D1 che popola il cloud e fa passare `updates.length > 0`.

**Passo 0 — de-posizionalizzare il registro dei rami.** `NOMI_RAMI_SYNC` (`controlPlaneSync.ts:24`) è un array separato dalle promise di `:226`, legato da una convenzione tenuta da un commento. Rimuovere un ramo rinomina tutti gli altri esattamente come aggiungerne uno: `leads_down` uscirebbe etichettato `accounts_down`. È **prerequisito** del passo 1, non un abbellimento. Struttura unica `const RAMI = [{nome, esegui}]` da cui derivano sia i nomi sia `Promise.allSettled(RAMI.map(r => r.esegui()))`.
> **Rosso**: test che rimuove il primo elemento dal registro e asserisce che i rimanenti restano `['leads_down','salesnav_up']`. Contro l'array posizionale odierno torna `['accounts_down','leads_down']` → FAIL. I 6 test attuali (`controlPlaneRamiSilenziosi.vitest.ts`) provano solo il predicato puro e resterebbero verdi: quello è il punto.

**Passo 1 — D2 = B+.** Rimozione della catena downsync + commento stantio + nota sul canale `telegram_commands`.
> **Rosso**: (a) test sul registro che asserisce 2 rami, `['leads_down','salesnav_up']` → FAIL oggi (3); (b) sentinella di repo: `grep` in `src/` di `UPDATE accounts` e `from('accounts').select` attesi a 0 → FAIL oggi (2 hit). La (b) è la guardia che impedisce il ritorno del ramo per inerzia.

**Passo 2 — probe dello schema cloud VIVO.** Non è un edit, è un gate. `supabase.full.schema.sql:7-14` **dichiara sé stesso in drift** ("la fonte di verità sono le migration applicate, non questo file"), e il worklog registra già `accounts` viva a 19 colonne. Da verificare prima di scrivere il payload: default reale di `metadata`, presenza reale della FK `daily_stats_cloud.account_id`, conteggio righe di `accounts`.
> **Rosso**: nessuno (è una misura). **Ma è bloccante**: senza, `metadata` NOT NULL-senza-default e la FK restano *assunti*, e il payload di D1 si costruirebbe su una premessa non verificata.

**Passo 3 — D1, costruttore di payload puro.** `costruisciProiezioneAccount(profili, statoQuarantenaLocale)` estratto puro (stessa lezione di `ramiFallitiDaEsiti`: la regola si prova, il wiring si legge).
> **Rosso**: quattro asserzioni che falliscono oggi perché la funzione non esiste, e che falliscono anche contro il payload del piano: (a) un profilo con `proxy: {username,password}` non fa comparire la password in `JSON.stringify` del record — questo è il rosso del criterio 4 e la sentinella contro il `{...profile}`; (b) le chiavi sono esattamente `{id, display_name, health, metadata}`, nessun `updated_at`, nessun `session_dir`, nessun `tier`, nessun `daily_*`; (c) con quarantena locale attiva `health === 'RED'` (contro il payload del piano, che omette `health` → FAIL); (d) `metadata.bot.declared_by === 'bot'` (contro `{}` → FAIL).

**Passo 4 — gate di proiezione.** `deveProiettare(hashPrec, hashNuovo, ultimaProiezioneAt, now)` puro + leader gate su `shouldRun`.
> **Rosso**: (a) hash uguale + ultima proiezione **oltre 24h** → attesa `true`; con un hash-gate semplice torna `false` → FAIL, ed è precisamente il buco di ⚔️4; (b) hash uguale + proiezione recente → `false`; (c) test che `shouldRun` di `control_plane_sync` torni `false` con `isLeader:false` → FAIL oggi.

**Passo 5 — chiudere il buco di bootstrap su `no_row`.** Solo **dopo** il passo 3/4, mai prima. `updateCloudAccountHealth` con `count===0` oggi logga e **ritorna senza lanciare** (`supabaseDataClient.ts:74-83`): il `.catch` di `bridgeAccountHealth` non scatta, **nessun outbox, nessun retry, la RED è persa per sempre**. La giustificazione scritta nel commento ("un mismatch di identità non si risolve ritentando") **decade con D1**: con la proiezione attiva la riga arriva, quindi il retry ha senso. Correzione: `throw` **solo se** l'id è in `getRuntimeAccountProfiles()`; id sconosciuto → resta `logWarn` (fail-closed sul rumore, niente DLQ per id fantasma).
> **Rosso**: test con client mockato che ritorna `count:0` per un id **configurato** → attesa: `updateCloudAccountHealth` lancia e `bridgeAccountHealth` deposita `cloud.account.health` in outbox → FAIL oggi (risolve senza lanciare). Il caso 'account-mai-creato' di `cloudWriteContract.vitest.ts` va **invertito nello stesso commit** che cambia il contratto: l'inversione è la prova visibile del cambio, non un test aggiustato per far passare il verde.
> **Worst-case**: un id configurato ma mai proiettabile spinge fino alla DLQ in ~64 min (`15s · 2^(n-1)`, 8 tentativi) con **un** alert Telegram critical. Limitato, e nel verso giusto.

**Passo 6 — redazione di `cp_events`.** `supabaseSyncWorker.ts:213-222` redige **un solo topic** (`cloud.lead.erase`); tutto il resto va nel DB di terze parti verbatim, mentre lo stesso oggetto passa per `sanitizeForLogs` verso Telegram (`incidentManager.ts:71` vs il `pushOutboxEvent` a `:55-66`). In transito oggi: URL di checkpoint LinkedIn, keyword di ricerca, lead completi. **Il criterio 4 del piano non è dichiarabile senza questo**: è già violato da un altro canale. Applicare `sanitizeForLogs()` al `loggedPayload` in un solo punto — safe per costruzione, perché `applyOutboxOperation` ha già girato sul payload grezzo.
> **Rosso**: test che un payload con email + URL LinkedIn arriva al mock di `cp_256events` redatto → FAIL oggi.

Gate di chiusura di ogni passo: `npm run conta-problemi` a 0 e `npm run build:backend` (il bot esegue `dist/`).

---

## 4. Fuori scope, ma non silenti

- **P1 anti-ban, separato e prioritario**: `launcher.ts:298` fa `const accountId = options.accountId ?? sessionDir`, e i chiamanti principali (`jobRunner.ts:171-174,:220-225`, `workflowEntryGuards.ts:89-96`, `loopCommand.ts:555-560`) **non passano `accountId`**. Quel valore seeda fingerprint e tempo di pressione dei tasti, e `sessionDir` è risolto su `process.cwd()`: spostare la repo o lanciare da `dist/` cambia il seme a parità di cookie jar → segnale di cambio-dispositivo sulla stessa sessione autenticata. **Non va toccato in questo lavoro** (`src/browser/**`, richiede `antiban-review`), ma è più grave di D1/D2 e va aperto subito. **Il §6 del piano resta vero per la versione che approvo**: B+ e D1 non rinominano né normalizzano alcun id locale e non toccano il perimetro.
- **`quarantine_until` cloud ha semantica sbagliata**: la scrive `pauseAutomation` col `pausedUntil` di una pausa WARN. Sotto B nessuno la legge, quindi non è bloccante; ma è una bugia di modellazione che morderà il primo che costruisce una dashboard. Correzione (colonna `paused_until` separata, o non passare il 4° argomento su YELLOW) tocca `src/risk/incidentManager.ts` → **tracciare con antiban-review**, non fare ora.
- **`'default'` come wildcard locale**: `setAccountQuarantine` reinterpreta `'default'` come «tutti» (`system.ts:562-566`). La forma corretta è una chiave che non è un id (`account_quarantine:__ALL__`) con rifiuto esplicito di `'default'` in ingresso. Tocca `system.ts` + `incidentManager.ts` + migration dei flag esistenti → **tracciare**. È il **prerequisito bloccante** di qualunque futuro canale comandi.
- **Nessun audit trail sul setter grezzo**: `setAccountQuarantine` non scrive `security_audit_events`, mentre `setQuarantine` sì (`incidentManager.ts:89-104`) e la regola CL12 lo impone già (`adminCommands.ts:473-482`). Sotto B nessun percorso remoto lo raggiunge, quindi non è più un difetto attivo — resta una nota per il canale comandi futuro.

---

## 5. Criteri di accettazione, riscritti

1. Se il bot va in quarantena, il Control Plane lo vede — **e se la riga non c'è ancora, il segnale non si perde: viene ritentato** (passo 5).
2. Se qualcosa nella catena verso il cloud si rompe, compare nei log **col nome del ramo giusto** (passo 0).
3. ~~Il cloud non perde i conteggi giornalieri~~ → **Le statistiche giornaliere cloud, oggi bloccate dalla foreign key su una tabella vuota, iniziano ad arrivare; non c'è arretrato da drenare (misurato: 0 eventi `cloud.daily_stat` in outbox) e la ri-dichiarazione non azzera nessun contatore.**
4. Nel cloud non finiscono password del proxy, email o percorsi del PC — **su nessun canale, `cp_events` incluso** (passo 6).
5. Il bot non crea account fantasma: solo profili realmente configurati, e **la proiezione non è mai un censimento** (nessuna cancellazione dedotta da un'assenza).
6. ~~Il bot non può essere fermato da uno stato cloud sbagliato~~ → **Nessuno stato cloud può fermare né far ripartire il bot: il canale cloud→locale per gli account non esiste, e se verrà costruito potrà solo imporre uno stop, mai rilasciarlo.**

---

## 6. Premesse ancora assunte (da chiudere al passo 2)

Non verificate dal vivo in questa sessione — `supabase.full.schema.sql` si dichiara in drift e l'MCP Supabase non ha esposto progetti: (a) default reale di `accounts.metadata`; (b) presenza reale delle FK `daily_stats_cloud.account_id` / `jobs_cloud.account_id`; (c) `accounts` a 0 righe **oggi** (il probe citato dal piano è del turno precedente). Il payload di D1 non si scrive prima di averle chiuse.