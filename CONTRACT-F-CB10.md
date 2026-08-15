# CONTRATTO F-CB.10 — «chi dichiara un account al Control Plane»

> Artefatto di negoziazione del contratto (tier `full`, GATE-COSTRUZIONE-360).
> Stato: **R1-PROPOSTA-b** — in review. NON ratificato, NON frozen.
> Il **cosa si fa** è in `PLAN.md`; il **perché** (verdetto avversariale che ha bocciato la
> prima rotta) è in `PLAN-REVIEW-VERDICT.md`. Questo file contiene SOLO i criteri con cui
> il lavoro verrà giudicato fatto o non fatto.

## Contesto minimo per un revisore che non ha visto la sessione

Il bot LinkedIn gira in locale (SQLite) e proietta parte del suo stato su un Control Plane
cloud (Supabase/PostgREST). La tabella cloud `accounts` è **vuota (0 righe, 19 colonne, PK
`id` text)** e tre tabelle hanno una **FK verso di essa**: `daily_stats_cloud.account_id`,
`jobs_cloud.account_id`, `telegram_commands.account_id`. Finché `accounts` è vuota, ogni
scrittura su quei tre canali muore in errore 23503.

**D1** (la capability nuova sotto contratto) = il bot **dichiara** al cloud i profili account
realmente configurati in locale, così i tre canali si sbloccano.
**D2** (già implementato, passi 0-1) = è stata **rimossa** la catena cloud→locale che leggeva
`accounts` e poteva togliere la quarantena a tutti gli account.

Fatti accertati che vincolano il design (misurati, non assunti):

- `MULTI_ACCOUNT_ENABLED` ha default `accountProfiles.length > 1`; con **un** profilo il flag è
  false e l'id degrada al sintetico `'default'`, che `setAccountQuarantine` mappa sul **flag di
  quarantena GLOBALE** (blocca/sblocca OGNI account).
- Nessun percorso di produzione scrive mai `GREEN` sul cloud (solo RED e YELLOW da
  `incidentManager`), e nessuna dashboard scrive `accounts`.
- `metadata jsonb not null default '{}'`; un merge PostgREST **sostituisce l'intero jsonb**.
- `control_plane_sync` è oggi l'unico task periodico senza gate `!ctx.isLeader`.

## Criteri utente (U*) — sovraordinati, IMMUTABILI, in parole d'uso

- **U1** — Se il bot va in quarantena, il Control Plane lo vede; e se la riga non c'è ancora, il
  segnale **non si perde**: viene ritentato.
- **U2** — Se qualcosa nella catena verso il cloud si rompe, compare nei log **col nome del ramo
  giusto**.
- **U3** — Le statistiche giornaliere cloud, oggi bloccate dalla foreign key su una tabella vuota,
  **iniziano ad arrivare**; non c'è arretrato da drenare e la ri-dichiarazione **non azzera nessun
  contatore**.
- **U4** — Nel cloud non finiscono password del proxy, email o percorsi del PC — **su nessun
  canale**, `cp_events` incluso.
- **U5** — Il bot non crea account fantasma: solo profili realmente configurati, e la proiezione
  **non è mai un censimento** (nessuna cancellazione dedotta da un'assenza).
- **U6** — **Nessuno stato cloud può fermare né far ripartire il bot**: il canale cloud→locale per
  gli account non esiste, e se verrà costruito potrà solo imporre uno stop, mai rilasciarlo.

## Criteri di contratto (C*) — asserzioni testabili

| # | Asserzione | VERIFY (comando) | EXPECT | Stato |
|---|---|---|---|---|
| C1 | Il registro dei rami di `controlPlaneSync` è de-posizionalizzato: togliere un ramo NON rinomina i rimanenti | `npx vitest run src/tests/controlPlaneRamiSilenziosi.vitest.ts` | exit 0, incluso il caso «registro amputato → nomi invariati» | done (passo 0) |
| C2 | La catena downsync degli account non esiste più nel **codice di produzione** | `grep -rn "syncAccountsDown\|applyCloudAccountUpdates\|fetchCloudAccountsUpdates" src/ --exclude-dir=tests \| wc -l` | `0` | done (passo 1) |
| C3 | Nessun percorso di **produzione** scrive o legge una tabella `accounts` **locale** | `grep -rniE "UPDATE accounts\|from\('accounts'\)\.select" src/ --exclude-dir=tests \| wc -l` | `0` | done (passo 1) |
| C4 | Il payload di proiezione ha **esattamente** le chiavi `{id, display_name, health, metadata}`, e un profilo con `proxy.password` non fa comparire la password nel record serializzato | `npx vitest run src/tests/proiezioneAccount.vitest.ts` | exit 0 (asserzioni a+b) | todo |
| C5 | `health` nel payload deriva dallo stato **LOCALE**: quarantena attiva ⇒ `'RED'` | stesso file | asserzione (c) PASS | todo |
| C6 | `metadata` è namespaced `{bot:{declared_by,last_declared_at,schema}}`, mai `{}` | stesso file | asserzione (d) PASS | todo |
| C7 | Il gate di proiezione ri-proietta a hash invariato se l'ultima proiezione riuscita è più vecchia di 24h | `npx vitest run src/tests/gateProiezione.vitest.ts` | exit 0 | todo |
| C8 | `control_plane_sync` non gira sui processi non-leader | `grep -n "isLeader" src/cli/commands/loopCommand.ts \| wc -l` ≥ 10 (oggi 9) + test dedicato | PASS | todo |
| C9 | `updateCloudAccountHealth` con `count===0` **lancia** se l'id è configurato (⇒ evento in outbox), resta `logWarn` per id sconosciuto | `npx vitest run src/tests/cloudWriteContract.vitest.ts` | exit 0 col caso `account-mai-creato` **invertito** | todo |
| C10 | Un payload con email + URL LinkedIn arriva a `cp_events` **redatto** | `npx vitest run src/tests/cpEventsRedazione.vitest.ts` | exit 0 | todo |
| C11 | Quality gate e build verdi a ogni passo | `npm run conta-problemi` + `npm run build:backend` | entrambi EXIT 0 (misurati **senza pipe**) | continuo |
| C12 | Nessun file del perimetro anti-ban toccato | `git diff --name-only origin/refactor/adk-split...HEAD \| grep -cE "src/(browser\|risk\|salesnav\|captcha\|workers)/"` | `0` | continuo |

### Correzioni già applicate a questa revisione (R1-PROPOSTA → R1-PROPOSTA-b)

- **C2 e C3**: la formulazione originale (`grep … src/`) **falliva per costruzione**: la sentinella
  di repo `src/tests/downsyncAccountRimosso.vitest.ts` contiene quelle stringhe *apposta* per
  vietarne il ritorno. Misurato: C2 = 2 match, C3 = 1 match, **tutti dentro la sentinella**.
  Aggiunto `--exclude-dir=tests`. Un criterio che non può diventare verde non è un criterio.
- **C8**: la soglia diceva «≥ 6 (oggi 5)», ma `isLeader` in `loopCommand.ts` conta **9** occorrenze
  oggi (misurato). Soglia riportata al delta reale: ≥ 10.

## Criteri fuzzy (CF*) — gradati dal reviewer, MAI criteri di DONE

- **CF1** — La rimozione della catena downsync non lascia nomi, commenti o tipi che raccontano un
  ramo che non esiste più.
- **CF2** — I test nuovi provano la **regola** (funzione pura), non il wiring: restano verdi se il
  wiring cambia forma e rossi se la regola cambia.
- **CF3** — I residui dichiarati (default di `metadata`, deprovisioning, P1 anti-ban, `'default'`
  come wildcard) restano **visibili** nel piano, non evaporano nella chiusura.

## ⚔️ ATTACCA QUI — dove sospetto che questo contratto sia debole

1. **U1 vs C9 — il ritentativo è davvero coperto?** C9 fa lanciare `updateCloudAccountHealth` a
   `count===0` per un id configurato, così l'errore genera un evento outbox. Ma se D1 gira PRIMA
   nello stesso ciclo, la riga esiste sempre e C9 non scatta mai: sto testando un ramo che in
   produzione potrebbe essere irraggiungibile? E se invece D1 fallisce, il RED viene ritentato o
   resta appeso a un outbox che nessuno drena?
2. **C4 è una allow-list *nel test*, non nel tipo.** Un `Record<string,unknown>` costruito a mano
   passa il test di oggi e domani ospita una chiave nuova aggiunta altrove. Il criterio dovrebbe
   imporre una forma che il compilatore controlla, non solo un'asserzione runtime?
3. **C7 — il pavimento temporale 24h non ha un criterio di *non*-regressione.** Nulla nel contratto
   vieta che il gate ri-proietti a OGNI ciclo (che passerebbe C7 banalmente) — manca l'asserzione
   opposta: «a hash invariato e ultima proiezione recente, NON proietta».
4. **C12 misura il branch, non il commit.** Se il lavoro finisce su un branch diverso o dopo un
   rebase, la base `origin/refactor/adk-split` cambia significato e il criterio può diventare
   verde per accidente.
5. **U5 non ha nessun C\* che lo copra.** Il deprovisioning («mai dedurre una cancellazione da
   un'assenza») è dichiarato nel piano ma non ha un criterio testabile: cosa impedisce a una
   revisione futura di introdurre un reconcile-by-delete senza far fallire nulla?
6. **U3 dice «non azzera nessun contatore» ma nessun C\* lo verifica.** Il merge PostgREST
   sostituisce l'intero jsonb: se `metadata` viene riscritto a ogni proiezione, cosa garantisce
   che un contatore scritto da un altro canale dentro `metadata` non venga perso?
