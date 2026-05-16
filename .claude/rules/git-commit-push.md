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

- `pre-bash-l1-gate.ps1` blocca `git commit` senza quality gate recente
- `pre-bash-git-gate.ps1` blocca `git commit` / `git push` se il repository non è nel giusto stato operativo
- `post-bash-git-audit.ps1` logga automaticamente la readiness git dopo quality gate e operazioni git rilevanti

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

## Auto-push post-commit — trigger automatico

Dopo ogni commit verificato, l'AI deve valutare l'auto-push **senza chiedere conferma all'utente** se le precondizioni sono soddisfatte. L'utente non deve dover ricordare di chiedere "fai anche push": è parte della chiusura naturale del blocco.

**Trigger**: il commit appena creato è su una "sezione naturale di chiusura". Una sezione è naturale se:
- chiude un'iniziativa coerente (feature completata, bug risolto, refactor finito, docs/regole codificate)
- non lascia stato di lavoro a metà nel working tree
- non è un commit intermedio di una serie ancora in corso

**Precondizioni cumulative** (tutte vere → push automatico, una falsa → fermarsi e dire perché):
- quality gate verde nello stesso ciclo (`post-modifiche` + `conta-problemi` = 0)
- `audit:git-automation` ritorna `READY` per push (non `REVIEW`/`BLOCKED`/`NOOP`)
- branch corrente non è `main`/`master`/`production` protetto **oppure** la policy del progetto autorizza push diretto
- upstream configurato e nessuna divergenza con remote
- il flusso non richiede PR/review (solo personale o tooling/docs)
- l'utente non ha esplicitamente detto di fermarsi al commit

**Precondizioni che ROMPONO il trigger** (anche con tutto il resto verde): branch condiviso senza policy chiara, modifica che tocca anti-ban/sicurezza/migration DB ad alto rischio, repository con review obbligatoria.

**Comportamento atteso**: dopo il commit verificato, esegue `git push` automatico se le precondizioni sono soddisfatte e dichiara cosa ha fatto. Se anche solo una precondizione manca, dichiara esplicitamente cosa manca e propone l'azione corretta (PR, attesa review, conferma utente). Mai silenzio.

**Memoria del comportamento**: se l'utente chiede "fai anche push" più di una volta in sessione, è un segnale che il trigger non sta scattando: l'AI deve correggere la propria valutazione, non aspettare il prompt successivo.

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
