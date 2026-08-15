# CONTRATTO F-CB.10 — «chi dichiara un account al Control Plane»

> Artefatto di negoziazione del contratto (tier `full`, GATE-COSTRUZIONE-360).
> Stato: **R1-PROPOSTA-e** — dopo DUE verdetti `REVISE` + un completeness-critic che ha trovato 3 CRITICI
> sulla versione gia corretta. NON ratificata, NON frozen.
> **CRITICO 1 CHIUSO** (`1e997e6`): il canale remoto non rilascia piu' una pausa di sistema (U6 -> C17).
> D1 resta fermo solo su ratifica + freeze e sui due prerequisiti che sono leve di Riccardo.
> Il **cosa si fa** è in `PLAN.md`; il **perché** della rotta è in `PLAN-REVIEW-VERDICT.md`.
> Qui SOLO i criteri con cui il lavoro sarà giudicato fatto o non fatto.

## Esito della review — tre canali indipendenti, nessuno APPROVED

| Canale | Verdetto | Peso |
|---|---|---|
| Evaluator a contesto vergine (read-only) | `VERDICT:REVISE` | 5 premesse esaminate, 3 false o incomplete |
| Codex cross-model (read-only) | `VERDICT:REVISE` | 22 obiezioni, 17 bloccanti |
| `completeness-critic` sulla **-c già corretta** | 13 finding, **3 CRITICI** | ha trovato ciò che i primi due non avevano nominato, e ha smontato una premessa che veniva da Codex |
| Verifiche mie alla fonte | — | 2 reperti indipendenti confermati dai revisori · 3 miei errori trovati dalle passate |

**Convergenza a tre** su due punti: la premessa del leader gate è falsa, e `health` derivato dalla sola
quarantena declassa a GREEN un allarme YELLOW vivo.

## 🔴 La radice comune: INSERT ≠ MERGE

Tre obiezioni indipendenti (il mio GREEN-sopra-YELLOW, Codex #20 su `defaultToNull`, Codex #6 sui
contatori) puntano allo stesso errore di progetto: **il piano tratta la proiezione come un'unica
`upsert`**, mentre le due operazioni hanno semantiche opposte.

- **Nascita della riga** — `health` DEVE esserci: il DDL ha `default 'GREEN'`
  (`src/sync/supabase.full.schema.sql:76`) e senza il campo la riga nasce GREEN mentre il bot è fermo.
- **Aggiornamento periodico** — `health` NON deve esserci: la proiezione girerebbe sopra il RED/YELLOW
  scritto dall'incident manager. Verificato: `pauseAutomation` (`src/risk/incidentManager.ts:106`)
  manda `YELLOW` al cloud (`:163`) ma chiama `setAutomationPause`, che scrive i flag
  `automation_paused*` (`src/core/repositories/system.ts:604-616`) e **non** quelli di quarantena;
  `getQuarantineStatus` (`:593-601`) legge **solo** `ACCOUNT_QUARANTINE_FLAG` ⇒ durante una pausa
  YELLOW ritorna `any:false`. Aggravante: il merge non azzera `quarantine_until`
  (`src/cloud/supabaseDataClient.ts:67`) ⇒ riga `GREEN` **con scadenza di quarantena nel futuro**.

🔴 **CORREZIONE (R1-PROPOSTA-d) — la terza obiezione era MIA e SBAGLIATA.** La R1-PROPOSTA-c
affermava: «`defaultToNull = true` ⇒ le colonne omesse vanno a NULL, quindi omettere i campi del
cloud li azzera». **Falso per il nostro payload**, verificato alla riga: `postgrest-js@2.100.1`
costruisce `?columns=` come **unione delle chiavi presenti negli oggetti**
(`dist/index.cjs:4071-4074`, `values.reduce((acc,x) => acc.concat(Object.keys(x)), [])`) ⇒ una
colonna **assente da TUTTI** gli elementi non entra in `columns` e PostgREST **non la tocca**: prende
il DEFAULT nell'insert, resta intatta nel merge. `missing=default` governa solo le chiavi presenti in
**alcuni** oggetti e assenti in altri (payload **eterogeneo**).
⇒ Vincolo che resta, in forma corretta: **il payload dev'essere OMOGENEO** — stesse chiavi per ogni
account, mai costruito con campi condizionali. Un payload eterogeneo (es. `display_name` solo per
alcuni) azzererebbe davvero, e nessun criterio lo intercetta oggi.
📌 Errore mio della stessa famiglia già a ledger: ho verificato che il flag **esiste**, non **come
agisce**. Ereditato da Codex e non ri-verificato alla fonte.

La decisione **INSERT ≠ MERGE resta**, perché poggiava su altri due piedi indipendenti (il declassamento
di `health` e la sostituzione integrale di `metadata`), non su questo.

⇒ **Forma ratificata**: due operazioni distinte.
1. **INSERT con `ignoreDuplicates: true`** (ON CONFLICT DO NOTHING) — nasce solo ciò che non esiste,
   non tocca **mai** una riga esistente. Include `health` calcolato sullo stato locale COMPLETO.
2. **UPDATE mirato** per la sola liveness (`metadata.bot.last_declared_at`) e per il display name.
   Non contiene `health`, non contiene contatori, non contiene `updated_at`.

## Prerequisiti — LEVE UTENTE, fuori dai criteri di DONE

> Un criterio di DONE deve poter diventare vero **con i miei soli strumenti**. Questi non possono:
> stanno qui, non fra i C\*.

- **P1 — il Control Plane è spento.** `supabaseControlPlaneEnabled` ha default `false`
  (`src/config/domains.ts:249`, contro `supabaseSyncEnabled: true` a `:243`) e `runControlPlaneSync`
  esce subito con `control_plane_disabled` (`src/cloud/controlPlaneSync.ts:210-212`).
  **Misurato alla fonte viva**: nel DB `data/linkedin_bot.sqlite` non esiste alcuna riga
  `control_plane.campaigns.last_run_at` né `…last_hash` ⇒ **il ciclo non è mai stato completato**.
  Senza `SUPABASE_CONTROL_PLANE_ENABLED=true` nel `.env`, **D1 nasce capability inerte** — il difetto
  che il criterio C6 del goal esiste per cacciare. Accenderlo è una decisione dell'utente.
- **P2 — le email dei lead sul cloud.** U4 nella forma «nel cloud non finiscono email, su nessun
  canale» **è già falso oggi**: `src/core/salesNavigatorSync.ts:561` invia `email` e `:568`
  `business_email` nella tabella cloud `leads`. O quelle email sono volute (e allora U4 va ristretto
  al profilo account), o vanno rimosse — ed è una decisione di prodotto/GDPR, non mia. **Qui U4 è
  ristretto; la rimozione resta tracciata come residuo.**

## Criteri utente (U\*) — sovraordinati, in parole d'uso

- **U1** — Se il bot va in quarantena, il Control Plane lo vede; e se la riga non c'è ancora, il
  segnale **non si perde**: viene ritentato.
- **U2** — Se qualcosa nella catena verso il cloud si rompe, compare nei log **col nome del ramo
  giusto** — e questo vale anche per la proiezione, la scrittura di health e il deposito in outbox,
  non solo per i rami di `controlPlaneSync`.
- **U3** — Le statistiche giornaliere cloud, oggi bloccate dalla foreign key su una tabella vuota,
  **iniziano ad arrivare** (a Control Plane acceso, P1); e la ri-dichiarazione **non azzera nessun
  contatore né declassa nessuno stato**.
- **U4** *(ristretto, vedi P2)* — Nel cloud non finiscono **password del proxy, percorsi del PC o
  l'email del profilo account** — su nessun canale, `cp_events` incluso.
- **U5** — Il bot non crea account fantasma, e la proiezione **non è mai un censimento**: nessuna
  cancellazione dedotta da un'assenza.
- **U6** *(riscritto nella -d, ✅ **RAGGIUNTO** nella -e — commit `1e997e6`)* — **Nessuno stato
  cloud può far ripartire il bot.** Era un obiettivo, non un'invariante: `loopCommand.ts` rilasciava
  la pausa su comando cloud. Ora il rilascio passa da `releaseAutomationPause({ channel })`
  (`src/core/repositories/system.ts`), che dal canale cieco ammette **solo** la pausa di origine
  utente e mai con quarantena o challenge accesi — e una pausa non può più indebolire quella in
  corso (il bypass `/pausa 5` sopra una pausa di sistema da 60′, trovato dalla `/antiban-review`).
  Il fix è stato fatto **prima** di D1, come imponeva il CRITICO 1, e copre anche i due gemelli che
  nessuno dei due revisori aveva visto: le route REST `/controls/resume` e
  `/v1/automation/controls/resume`. VERIFY: **C17**.
  🔻 Residuo dichiarato: `restart` dal cloud resta. Misurato prima di lasciarlo: nessun fail-safe
  vive in memoria — pausa, quarantena e cooldown captcha stanno tutti in `sync_state`
  (`challengeHandler.ts:52-60` lo persiste da M26) ⇒ un riavvio **non rilascia** niente.
  ~~forma precedente: «il canale cloud→locale per gli account non esiste, e se verrà costruito potrà
  solo imporre uno stop»~~ — scritta credendo che il canale non esistesse.

## Criteri di contratto (C\*)

| # | Asserzione | VERIFY | EXPECT |
|---|---|---|---|
| C1 | Togliere un ramo da `RAMI_SYNC` NON rinomina i rimanenti — provato **amputando un ramo che oggi esiste** (`leads_down` o `salesnav_up`), non uno già rimosso | `npx vitest run src/tests/controlPlaneRamiSilenziosi.vitest.ts` | exit 0 |
| C2 | La catena downsync non esiste più nel codice di **produzione** | `grep -rn "syncAccountsDown\|applyCloudAccountUpdates\|fetchCloudAccountsUpdates" src/ --exclude-dir=tests \| wc -l` | `0` |
| C3 | Nessun percorso di **produzione** legge stato cloud degli account per **decidere una pausa o una quarantena locale** (vincolo di data-flow, non di nome) | `npx vitest run src/tests/downsyncAccountRimosso.vitest.ts` esteso: nessun import di `fetchCloudAccounts*` dentro `src/risk/**` e `src/core/repositories/system.ts` | exit 0 |
| C4 | Il payload ha un **tipo chiuso** `AccountProjection` (non `CloudAccount`, che ammette `session_dir`/`proxy_url`/contatori), imposto alla **firma del writer**; un profilo con `proxy.password` non fa comparire la password nel record serializzato | `npx vitest run src/tests/proiezioneAccount.vitest.ts` + `npm run typecheck` con un test negativo che **non deve compilare** | exit 0 |
| C5 | `health` alla **nascita** deriva dallo stato locale COMPLETO: flag globale ⇒ tutti `RED` · quarantena per-account ⇒ solo quello `RED` · **pausa automazione attiva ⇒ `YELLOW`** · altrimenti `GREEN` | stesso file, quattro casi | 4/4 PASS |
| C6 | `metadata` è namespaced `{bot:{declared_by,last_declared_at,schema}}`, mai `{}` | stesso file | PASS |
| **C13** | **La proiezione periodica non declassa mai**: su riga esistente non scrive `health`, non scrive contatori, non scrive `updated_at`; e un merge su riga `RED`/`YELLOW` la lascia tale | `npx vitest run src/tests/proiezioneNonDeclassa.vitest.ts` con riga preesistente `YELLOW` + `quarantine_until` futuro | exit 0 |
| **C14** | L'insert bulk usa `ignoreDuplicates: true`; **nessuna chiamata** a `insert`/`upsert` verso `accounts` lascia `defaultToNull` al default implicito | stesso file + `grep -n "from('accounts')" -A3 src/cloud/supabaseDataClient.ts` | asserzione PASS |
| C7 | Il gate ri-proietta a hash invariato oltre 24h **e NON ri-proietta** a hash invariato e proiezione recente. L'hash è calcolato su un payload **senza timestamp** (`last_declared_at` materializzato dopo il gate, altrimenti l'hash cambia sempre e il gate è un no-op) | `npx vitest run src/tests/gateProiezione.vitest.ts` | exit 0, entrambi i versi |
| **C15** | **ACK ≠ EFFETTO**: hash e timestamp locali avanzano **solo dopo** conferma dell'effetto; su errore, `count` inatteso o crash intermedio restano invariati (⇒ il ciclo dopo ritenta) | stesso file, caso «writer lancia dopo l'I/O» | PASS |
| C8 | `control_plane_sync` non gira sui processi non-leader — verificato **eseguendo `shouldRun` con `isLeader:false`**, non contando la stringa `isLeader` | `npx vitest run src/tests/loopTasksLeaderGate.vitest.ts` | exit 0 |
| C9 | `updateCloudAccountHealth` **rifiuta prima dell'I/O** un id non configurato; per un id configurato, `count===0` **e** `count===null` sono «effetto non provato» ⇒ lancia (⇒ outbox) | `npx vitest run src/tests/cloudWriteContract.vitest.ts` | exit 0, caso `account-mai-creato` invertito |
| C10 | `cp_events` è redatto per email, **URL con credenziali**, **percorsi Windows/POSIX** e URL LinkedIn — non solo `linkedin.com/in` (`src/security/redaction.ts:4-23` oggi non copre gli altri) | `npx vitest run src/tests/cpEventsRedazione.vitest.ts` | exit 0, 4 classi |
| **C16** | **U5 ha una guardia**: nessun percorso di produzione emette `DELETE` verso `accounts`, e i casi «zero profili», «override CLI inesistente» (`src/accountManager.ts:108-110` ⇒ `[]`) e «lista parziale» producono **zero cancellazioni** | `npx vitest run src/tests/proiezioneAdditiva.vitest.ts` | exit 0, 3 casi |
| C11 | Gate e build verdi **a ogni passo**, con evidenza per passo: ledger `docs/tracking/F-CB10-EVIDENCE.md` con comando, exit code e SHA del commit | il ledger esiste e ha una riga per commit del lavoro | 1 riga per SHA |
| C12 | Nessun file del perimetro anti-ban toccato, su base **congelata** e includendo staged/unstaged | `git diff --name-only <BASE_SHA>..HEAD` + `git status --porcelain`, entrambi filtrati su `src/(browser\|risk\|salesnav\|captcha\|workers)/` | `0` in entrambi |
| **C17** | **Il canale remoto è monotono-restrittivo** (VERIFY di U6): dal canale cieco una pausa di sistema, una quarantena o un challenge in attesa **non** si rilasciano; una pausa non indebolisce quella in corso; nessun modulo che esegue ordini da fuori importa un rilascio incondizionato | `npx vitest run src/tests/rilascioPausaRemota.vitest.ts src/tests/canaleRemotoMonotono.vitest.ts` | exit 0, **17 test** (13 comportamento + 3 sentinelle di forma + 1 mappatura 409) |

`BASE_SHA` = **il commit del freeze**, cioè l'ultimo prima che parta una riga di codice di D1 — non un
commit precedente al contratto, altrimenti il diff include lavoro che C12 non deve giudicare. Si
scrive qui **alla ratifica**, non prima: finché il contratto è in revisione il valore cambierebbe a
ogni commit. (Correzione di una premessa falsa della prima stesura, che indicava `28cdfbd`
chiamandolo «HEAD al momento della R1-PROPOSTA-c» quando HEAD era già `421b348`.)

## Criteri fuzzy (CF\*) — gradati, MAI criteri di DONE
- **CF1** — Nessun nome, commento o tipo racconta un ramo che non esiste più.
- **CF2** — I test provano la **regola** (funzione pura), non il wiring.
- **CF3** — I residui dichiarati restano **visibili**, non evaporano nella chiusura.

## 🔴 R1-PROPOSTA-d — cosa cambia dopo il `completeness-critic` (13 finding, 3 CRITICI)

Il critico è stato lanciato **sulla -c**, cioè sulla versione già corretta da due revisori: cercava
ciò che una riscrittura fatta sotto 22 obiezioni tende a lasciare aperto — non le obiezioni ricevute,
ma quelle che nessuno ha nominato. Ne ha trovate tre che fermano il lavoro.

### ✅ CRITICO 1 — CHIUSO in `1e997e6` — D1 riaccendeva un canale che RILASCIAVA lo stop (U6 era già falso)
`loopCommand.ts:263` polla la tabella **cloud** `telegram_commands`; `:277-279` su `riprendi`/`resume`
chiama `clearPauseState()` (= `clearAutomationPause`, import a `:30`) ⇒ **cancella una pausa imposta
dall'incident manager**; `:286` su `restart` fa `process.exit(0)`. È inerte **solo** perché `accounts`
è vuota (FK 23503) ⇒ **D1 lo accende**, mentre `PLAN.md:55-58` lo celebra come «sblocca tre canali».
⇒ **D1 NON PARTIVA** finché il canale non fosse monotono-restrittivo. **Fatto prima di D1**, come
imponeva questo blocco: il rilascio passa da `releaseAutomationPause({ channel })` e dal canale cieco
ammette solo la pausa di origine utente (`1e997e6`). U6 è ora una constatazione RISOLTA e il C\*
richiesto esiste: **C17**. Il perimetro reale era più largo di quanto scritto qui — le bocche di
rilascio erano **tre** (canale cloud + due route REST), e il gate è stato messo dove sta lo stato.
Su `restart`: resta, ma è stato misurato che nessun fail-safe vive in memoria ⇒ un riavvio non
rilascia nulla (dettaglio sotto U6).

### ⛔ CRITICO 2 — la redazione pianificata di `cp_events` ucciderebbe l'audit log
`sanitizeObject` redige il valore quando la **chiave** è sensibile (`security/redaction.ts:70-74`) e
`isSensitiveKey` splitta su `_` ⇒ `idempotency_key` → contiene `'key'` (`:9`) → `[REDACTED]`. Il piano
applica `sanitizeForLogs` al `loggedPayload` intero, che va in upsert con
`onConflict:'idempotency_key'` (`supabaseSyncWorker.ts:223-226`) ⇒ **ogni evento scriverebbe la stessa
riga** e l'audit trail collasserebbe su una, con C10 verde.
⇒ Redigere **solo `payload.payload`**, mai `idempotency_key`/`topic`/`created_at`. Nuovo criterio:
«N eventi distinti ⇒ N righe con chiavi distinte».

### ⛔ CRITICO 3 — il filtro «id configurato» di C9 è process-scoped e perde la RED
`getRuntimeAccountProfiles()` sotto `--account` ritorna solo quell'account, o `[]`
(`accountManager.ts:91-102`). Il drain gira nell'orchestrator (`orchestrator.ts:750`), lanciabile con
`--account acc2` ⇒ un evento di `acc1` verrebbe classificato «non configurato», loggato senza throw, e
**marcato CONSEGNATO** (`supabaseSyncWorker.ts:241`): la RED sparisce in silenzio.
⇒ Confrontare con **`config.accountProfiles`** (lista configurata), mai col runtime filtrato dalla CLI.

### Correzioni ai criteri (accolte, da applicare nella -d)
- **C5** — dire QUALE quarantena per QUALE id: globale ⇒ **tutti** RED · per-account ⇒ solo quello ·
  nessuna ⇒ GREEN. Un test sul solo per-account passa mentre il codice ignora il flag globale.
- **C8** — il «rosso» **non è rosso**: `shouldRun` è `!ctx.dryRun && config.supabaseControlPlaneEnabled`
  e il flag è **spento** ⇒ il test passerebbe oggi, prima del fix, misurando il flag e non il gate.
  Va forzato `supabaseControlPlaneEnabled=true` e asseriti **entrambi** i versi.
- **C9** — il VERIFY ordinava di invertire il caso `account-mai-creato`, che è un id **non**
  configurato e quindi NON deve lanciare: il test esistente va **conservato**, se ne **aggiunge** uno
  con id configurato. E «rifiuta prima dell'I/O» va disambiguato (throw vs skip+log).
- **C13** — è scritto **solo in negativo**, quindi il nulla lo soddisfa: un'implementazione che non
  emette mai l'UPDATE è verde. Serve la **metà positiva**: «riga preesistente ⇒ `last_declared_at`
  avanzato **e** `health` invariato», più l'**allow-list** delle colonne ammesse nell'UPDATE.
- **C15** — «`count` inatteso» è indefinito e con `ignoreDuplicates` `count===0` è lo stato **normale**:
  definire l'atteso **per fase** (insert: `count ∈ [0..N]`, la prova è l'assenza di errore; update
  mirato: `count === N`). Senza, C14 e C15 non possono essere veri insieme.
- **C1/C14/C16** — VERIFY ciechi: C1 è tautologico sul tipo (i nomi derivano dagli stessi oggetti), C16
  non può provare da un test puro che nessun percorso di **produzione** emetta DELETE, C14 usa un
  `grep -A3` che non è un'asserzione ⇒ servono **sentinelle di sorgente**, come già fa C2.
- **U1/U2** — entrambi allargati oltre ciò che il lavoro copre: il retry di U1 non parte perché in
  quarantena il `doctor_gate` (`loopCommand.ts:447-457`, `onError:'abort'`) interrompe il ciclo prima
  del drain; U2 include il deposito in outbox, che `cloudBridge.ts:141-148` inghiotte in un `catch {}`
  muto. Vanno ristretti o il lavoro va esteso — tenerli così li rende **non falsificabili**.
- **`health` è monotono-degradante**: nessuno riscrive mai GREEN verso il cloud ⇒ una riga nata YELLOW
  durante una pausa resta YELLOW **per sempre**. Serve un C\* sul percorso di ritorno, o la
  dichiarazione esplicita che nessun consumatore deve fidarsi di quel campo.

## Residui DICHIARATI (non silenti, non chiusi)
1. **Discrepanza sulle FK**: lo schema versionato dichiara **cinque** FK verso `accounts`
   (`src/sync/supabase.full.schema.sql:95,123,181,206,240`), il probe live ne ha misurate **tre**. Il
   file si autodichiara in drift (`:7-13`). Va ri-probato con artefatto ripetibile prima di
   affermare un numero.
2. **Default live di `metadata`**: non misurabile read-only (OpenAPI non espone i default jsonb).
   Neutralizzato per design (si passa sempre `metadata`), **non accertato**.
3. **U2 oltre i rami**: `pushOutboxEvent` che fallisce dentro `bridgeAccountHealth`
   (`src/cloud/cloudBridge.ts:137-148`) viene inghiottito senza log. Fuori dallo scope di D1, tracciato.
4. **Retry durevole in quarantena**: in quarantena il drain dell'outbox non è raggiunto ⇒ il retry che
   U1 promette non parte da solo. La forma minima che rende U1 vero va decisa prima di dichiararlo.
5. **Email dei lead sul cloud** (P2) — decisione dell'utente.
6. **Deprovisioning esplicito** — atto locale, fuori da questo lavoro.

## Freeze — cosa firma la ratifica
Al freeze si congelano insieme: il **testo U\*/C\***, il **digest di `PLAN.md`** e `BASE_SHA`.
Senza il digest, `PLAN.md` può cambiare dopo l'approvazione lasciando verdi gli stessi C\*.
