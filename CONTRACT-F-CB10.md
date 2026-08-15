# CONTRATTO F-CB.10 — «chi dichiara un account al Control Plane»

> Artefatto di negoziazione del contratto (tier `full`, GATE-COSTRUZIONE-360).
> Stato: **R1-PROPOSTA-c** — riscritta dopo DUE verdetti `REVISE` indipendenti. NON ratificata, NON frozen.
> Il **cosa si fa** è in `PLAN.md`; il **perché** della rotta è in `PLAN-REVIEW-VERDICT.md`.
> Qui SOLO i criteri con cui il lavoro sarà giudicato fatto o non fatto.

## Esito della review — due canali, entrambi `REVISE`

| Canale | Verdetto | Peso |
|---|---|---|
| Evaluator a contesto vergine (read-only) | `VERDICT:REVISE` | 5 premesse esaminate, 3 false o incomplete |
| Codex cross-model (read-only) | `VERDICT:REVISE` | 22 obiezioni, 17 bloccanti |
| Verifiche mie alla fonte | — | 2 reperti indipendenti, entrambi poi confermati dai revisori |

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

E l'omissione **non protegge**: `postgrest-js@2.100.1` ha `defaultToNull = true`
(`node_modules/@supabase/postgrest-js/dist/index.cjs:4062`) e aggiunge `Prefer: missing=default` solo
se richiesto (`:4069`) ⇒ le colonne omesse vanno a **NULL**, non al default né al valore esistente.
«Ometto i campi posseduti dal cloud per proteggerli» era **falso**: li azzerava.

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
- **U6** — **Nessuno stato cloud può fermare né far ripartire il bot**: il canale cloud→locale per gli
  account non esiste, e se verrà costruito potrà solo imporre uno stop, mai rilasciarlo.

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

`BASE_SHA` da congelare al freeze: **`28cdfbd`** (HEAD al momento della R1-PROPOSTA-c).

## Criteri fuzzy (CF\*) — gradati, MAI criteri di DONE
- **CF1** — Nessun nome, commento o tipo racconta un ramo che non esiste più.
- **CF2** — I test provano la **regola** (funzione pura), non il wiring.
- **CF3** — I residui dichiarati restano **visibili**, non evaporano nella chiusura.

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
