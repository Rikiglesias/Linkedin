---
name: git-commit-push
paths:
  - "**"
enforcement:
  - pre-bash-l1-gate.ps1 (blocking)
  - pre-bash-git-gate.ps1 (blocking)
  - post-bash-git-audit.ps1 (async audit)
  - .githooks/pre-commit (security scan, attivare con npm run setup:git-hooks)
---

# Commit e push — policy operativa esplicita

> Path-scoped rule estratta da AGENTS.md. Attiva sempre (`**`).

## Principi

- Il commit non deve dipendere dalla memoria dell'utente: quando un'unità logica di lavoro è davvero verificata, il sistema deve arrivare al commit in modo predefinito.
- **Auto-commit by default**: dopo verifiche verdi (`post-modifiche` + `conta-problemi` a zero) l'AI deve proporre o attivare il commit come chiusura naturale del blocco.
- **No commit automatico cieco** se:
  - il lavoro è ancora a metà
  - ci sono modifiche non correlate mescolate nello stesso working tree
  - il task è bloccato o richiede ancora conferma sostanziale
  - i gate non sono verdi
- Il **push non è automatico in assoluto**: tocca remote condivisi, branch policy, review e rischio operativo.
- **Auto-push consentito** solo quando tutte queste condizioni sono vere:
  - branch e destinazione sono chiari
  - upstream già configurato oppure strategia di push esplicita
  - nessuna divergenza o conflitto remoto
  - il flusso corretto non richiede PR o review preventiva
  - l'utente non ha chiesto di fermarsi prima del remote
- **No auto-push** se il branch è protetto/condiviso, se serve PR, se il remote è divergente, se la policy di integrazione non è chiara o se il task tocca aree ad alto rischio che richiedono review.
- Se il sistema arriva al commit ma non al push, l'AI deve dirlo in modo esplicito e motivato.

## Verifica deterministica disponibile

`npm run audit:git-automation`:
- classifica il repository in `READY` / `REVIEW` / `BLOCKED` / `NOOP` per commit e push
- script affidabili per hook/workflow: `audit:git-automation:strict:commit`, `audit:git-automation:strict:push`, `audit:git-automation:json`
- non sostituisce `post-modifiche` e `conta-problemi`: governa il contesto git, non la qualità del codice

## Enforcement meccanico in Claude Code

Hook globali registrati in `~/.claude/settings.json` (via `MANAGED_ROUTER_HOOKS` in `model-router-config.mjs`):

- `pre-bash-l1-gate.ps1` (PreToolUse Bash, blocking) blocca `git commit` senza quality gate recente
- `pre-bash-git-gate.ps1` (PreToolUse Bash, blocking) blocca `git commit` / `git push` se il repository non è nel giusto stato operativo
- `post-bash-git-audit.ps1` (PostToolUse Bash, async) logga la readiness git dopo quality gate e operazioni git rilevanti — **logga soltanto, non esegue commit né push**

### Due hook PostToolUse Edit/Write che committano — chi fa cosa, perché non collidono

Sullo stesso matcher `Edit|Write` girano due hook globali con **trigger disgiunti** (complementari, non ridondanti):

- `post-edit-auto-commit.ps1` (async): committa **automaticamente** ogni modifica a file **già tracciati** (`git add -u`, mai untracked), rate-limited a max 1 commit / 5 min, messaggio `auto: N file (HH:mm)`. Scatta su **qualsiasi** edit a file tracciati. **Non pusha mai.** Opt-out per repo: file `.no-auto-commit` nella root (raccomandato dove vale "commit solo a L9=DONE").
- `post-edit-request-action.ps1` (sync): committa — ed è l'**unico** che pusha — **solo quando l'AI crea esplicitamente** i file trigger `.claude/REQUEST_COMMIT` (1ª riga = messaggio) / `.claude/REQUEST_PUSH`. Prima di committare esegue i gate `post-modifiche` + `audit:git-automation:strict:commit`; il push richiede anche `audit:git-automation:strict:push` READY. Mai `git add .`, mai `--no-verify`.

Non collidono: il primo è il commit di default su edit tracciati; il secondo è il commit/push **on-demand verificato** quando serve un messaggio voluto o un push. Con `.no-auto-commit` attivo nel repo, resta solo il percorso esplicito (`REQUEST_COMMIT`/`REQUEST_PUSH`). Il push automatico vero e proprio passa **solo** da `post-edit-request-action.ps1` via trigger esplicito: vedi la sezione "Auto-push post-commit" sotto — non esiste un hook che pusha da solo dopo un `git commit` da Bash.

## Enforcement git nativo

Versionato in `.githooks/`, attivare con `npm run setup:git-hooks`:
- `pre-commit` esegue `scripts/security/check-no-secrets.mjs` — bloccante su secret reali (OpenAI/Anthropic/GitHub PAT/Google API/AWS/Slack/JWT/PEM private key)
- whitelist su pattern di test (sk-XXX, sk-test-, your-api-key, ecc.)
- eseguibile manualmente: `npm run security:scan`

## Primitive correnti

- commit/push intelligente via skill `git-commit`
- PR via skill `git-create-pr`
- audit contestuale git via `audit:git-automation`
- gate git via hook globali Claude Code

## Livelli di review: locale / branch / audit periodico

Tre livelli distinti per scope, momento e primitive. Non sono intercambiabili: usare quello giusto per la situazione.

| Livello | Quando | Scope | Primitive |
|---|---|---|---|
| **Review locale** (pre-commit) | Working tree dirty, prima di committare un'unità logica | Solo il diff NON committato (incluse untracked) | `/code-review` o `/simplify` sul diff locale; `/code-review:review-local-changes`; per LinkedIn-touch anche `antiban-review` |
| **Review di branch** (pre-merge) | Branch pronto, prima di PR/merge su base condivisa | Tutti i commit del branch vs base | `code-review:code-review` su PR; `/code-review ultra <PR#>` (cloud, billed, user-triggered); apertura PR via skill `git-create-pr` |
| **Audit periodico** (cadenza) | Settimanale/mensile o pre-release, NON per singolo blocco | Salute sistemica del control plane, non un diff | `npm run audit:weekly` / `audit:monthly`; `/deep-hygiene`; `security-reviewer` SAST full |

Regole:
- La review locale è la chiusura naturale del blocco prima del commit; non sostituisce la review di branch su codice condiviso ad alto rischio (anti-ban, auth, migration DB).
- La review di branch è obbligatoria quando il flusso richiede PR/review (vedi precondizioni auto-push sotto): non auto-pushare bypassandola.
- L'audit periodico NON va eseguito a ogni blocco (zero-H light-vs-deep): è manutenzione a cadenza, tracciata in `docs/tracking/AI_AUDIT_CADENCES.md`.

## Auto-push post-commit — valutazione del modello (NON un hook automatico)

> **Stato reale (verificato 2026-06-05)**: l'auto-push **NON** è enforced da un hook attivo. È una **valutazione che fa il MODELLO** dopo un commit, quando le precondizioni sotto sono vere. Non aspettarti che uno script pushi da solo.
>
> Evidenza: nessun hook `*push*` è registrato — non in `MANAGED_ROUTER_HOOKS` (`~/.claude/scripts/model-router-config.mjs`), non in `~/.claude/settings.json`, non in `.claude/settings.json` del repo. Lo script `hooks/post-bash-auto-push.ps1` esiste nel repo ma è **orfano**: non è in `~/.claude/hooks/` (dove gli hook attivi vengono risolti) e nessun matcher lo dispatcha. Il log storico `C:\Users\albie\memory\auto-push-log.txt` è **fermo dal 2026-05-19**: era l'output di una versione precedente del flusso, ora cessata. L'unico hook git PostToolUse Bash attivo è `post-bash-git-audit.ps1`, che **logga la readiness git** (audit async) ma **non esegue push**.

L'AI deve **valutare** l'auto-push dopo ogni commit verificato e, se le precondizioni sono soddisfatte, eseguire `git push` come tool call esplicita **senza chiedere conferma**. L'utente non deve dover ricordare di chiedere "fai anche push": è parte della chiusura naturale del blocco. Ma è il modello a doverlo fare attivamente — niente automatismo deterministico a cui appoggiarsi.

**Quando valutare il push**: il commit appena creato è su una "sezione naturale di chiusura". Una sezione è naturale se:
- chiude un'iniziativa coerente (feature completata, bug risolto, refactor finito, docs/regole codificate)
- non lascia stato di lavoro a metà nel working tree
- non è un commit intermedio di una serie ancora in corso

**Precondizioni cumulative** (tutte vere → push, una falsa → fermarsi e dire perché):
- quality gate verde nello stesso ciclo (`post-modifiche` + `conta-problemi` = 0)
- `npm run audit:git-automation:strict:push` ritorna `READY` (non `REVIEW`/`BLOCKED`/`NOOP`)
- branch corrente non è `main`/`master`/`production` protetto **oppure** la policy del progetto autorizza push diretto
- upstream configurato e nessuna divergenza con remote (verificare `git fetch` + `rev-list HEAD..@{u}`)
- il flusso non richiede PR/review (solo personale o tooling/docs)
- l'utente non ha esplicitamente detto di fermarsi al commit

**Precondizioni che ROMPONO la valutazione** (anche con tutto il resto verde): branch condiviso senza policy chiara, modifica che tocca anti-ban/sicurezza/migration DB ad alto rischio, repository con review obbligatoria.

**Comportamento atteso**: dopo il commit verificato, l'AI esegue `git push` come tool call se le precondizioni sono soddisfatte e dichiara cosa ha fatto. Se anche solo una precondizione manca, dichiara esplicitamente cosa manca e propone l'azione corretta (PR, fetch+rebase, attesa review, conferma utente). Mai silenzio, mai "ho pushato" presunto senza eseguire il comando.

**Memoria del comportamento**: se l'utente chiede "fai anche push" più di una volta in sessione, è un segnale che la valutazione non sta scattando: l'AI deve correggere il proprio comportamento, non aspettare il prompt successivo.

## Fallback per ambienti senza hook PowerShell

In Claude Code i gate git sono enforced via hook PowerShell. In ambienti che NON eseguono questi hook nativamente (Codex, Cloud Code, Cursor, shell diretta), l'AI deve **simulare manualmente**:

1. **Pre-commit gate**: verificare che `npm run conta-problemi` sia stato eseguito con esito verde negli ultimi ~60 minuti. Se non lo è, eseguirlo prima del commit.
2. **Pre-commit gate git**: eseguire `npm run audit:git-automation:strict:commit` — deve ritornare `READY`. Se `REVIEW`/`BLOCKED`/`NOOP`, fermarsi e dichiarare il motivo.
3. **Pre-push gate**: eseguire `npm run audit:git-automation:strict:push` — deve ritornare `READY`. Se non, niente push automatico.
4. **Native git hooks** (`.githooks/pre-commit`): attivati una volta sola con `npm run setup:git-hooks`. Funzionano anche fuori Claude Code (sono git hooks nativi).
5. **Output post-commit**: dichiarare esplicitamente "commit fatto", "push fatto" oppure "push non eseguito perché X".

**Cosa NON cambia**:
- Native git hook `.githooks/pre-commit` (security scan) funziona ovunque dopo `setup:git-hooks`.
- `npm run conta-problemi` / `npm run audit:git-automation` sono npm scripts cross-environment.
- Le regole "Auto-commit by default", "No auto-push se branch protetto", "Precondizioni cumulative" valgono identiche.

**Differenza operativa**:
- In Claude Code: hook bloccano automaticamente. Il modello non può bypassare per dimenticanza.
- Fuori Claude Code: il modello deve eseguire i gate come tool call espliciti. La dimenticanza diventa miss reale.

**Quando l'utente lavora in Codex/Cloud Code**, la regola è rinforzata: dichiarare sempre, prima del commit, l'output del gate manuale. Niente "ho committato" silenzioso.
