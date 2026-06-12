# AGENTS.md — Regole operative di progetto

Questo file e' il riferimento operativo canonico della repo per agenti AI e sessioni di lavoro.
`CLAUDE.md` e' solo un adapter per Claude Code e non deve duplicare logica o backlog.
Le regole globali (P0, L1-L9, parita' ambienti, memoria, anti-dimenticanza) stanno in `~/.claude/CLAUDE.md`.
Le regole di orchestrazione cognitiva, requirement ledger, orizzonti temporali, blast radius documentale e handoff sono in `docs/AI_RUNTIME_BRIEF.md` (reiniettato automaticamente dai hook a ogni prompt).

## Scope: questo repo è il LinkedIn Bot applicativo

Questa repo è il **runtime del bot LinkedIn** (browser, risk engine, antiban, scheduler, proxy, dashboard, n8n workflow). Vive in `src/`. Il backlog applicativo è `docs/LINKEDIN_IMPLEMENTATION_LIST.md` + `todos/workflow-architecture-hardening.md`.

Il **sistema AI globale (ADK)** — regole di ragionamento, skill, hook, subagent, audit di governance, plugin packaging, output styles — **NON vive più in questo repo**: è stato estratto (adk-split) e vive in `~/.claude/` (SSOT viva: regole, hook, skill, router) + `AI-Control-Plane/` (audit di governance eseguibili + spec del sistema AI). È portabile su qualsiasi progetto. Restano qui solo: `docs/AI_RUNTIME_BRIEF.md` (digest runtime del progetto) e gli `src/scripts/*Audit.ts` che verificano i canonici DI QUESTO repo (es. `aiControlPlaneAudit` = "meta A" dei soli canonici del progetto; la governance ADK pura è in `AI-Control-Plane/06-audit`).

**Implicazione per le decisioni**:
- Capability candidata utile all'ADK ma "fuori scope LinkedIn" → tracciarla per `~/.claude`/`AI-Control-Plane`, non scartarla.
- Anti-ban / proxy / LinkedIn-specific → restano nel bot, non inquinano l'ADK globale.
- Best practice canoniche di ragionamento → vivono nell'ADK globale (`~/.claude`), applicate ovunque.

## Fonte di verita' e routing strumenti

- Fatto interno stabile → codice, test, log, config, documenti canonici del repo.
- Libreria, API, provider, anti-ban, piattaforma esterna → web/docs ufficiali obbligatori prima di modificare.
- Stato reale sistema esterno → MCP o tool equivalenti; mai supposizioni.
- Procedura cognitiva ripetibile → skill. Regola non dimenticabile → hook. Controllo deterministico → script/test/lint. Automazione durevole → n8n/workflow persistente.
- Documenti, audit e stato reale divergono → bug operativo da correggere subito.
- Best practice non autoreferenziale: "fatto da noi" non significa "migliore possibile". Regole, metodi, capability, hook, skill, MCP, workflow e architetture vanno confrontati periodicamente con fonti ufficiali/recenti prima di dichiararli best practice; tracciare fonte, gap, decisione e verifica.

## Automazione: ordine di promozione

Se un passaggio viene dimenticato piu' di una volta, va promosso:
1. chat/nota → 2. file canonico → 3. checklist/template → 4. skill → 5. hook → 6. script/audit → 7. workflow/n8n.
Azioni ad alto rischio: conferma esplicita. Lettura, quality gate, enforcement, audit, monitoraggio: il piu' automatici possibile.
Se una capability manca in un ambiente, documentare il gap e chiuderlo; non accettarlo per abitudine.

## File canonici da leggere e mantenere allineati

- `README.md`: overview tecnica del progetto e struttura principale.
- `docs/LINKEDIN_IMPLEMENTATION_LIST.md`: lista lineare item LinkedIn-specifici per review e pruning.
- `docs/AI_RUNTIME_BRIEF.md`: digest runtime compatto del progetto usato dai hook per reiniettare le regole davvero critiche. Non sostituisce i canonici; deve restare allineato a loro.
- **Canonici ADK universali** (sistema AI desiderato, backlog ADK, operating model, orchestrator contract, implementation list globale) → estratti in `AI-Control-Plane/spec/` + `~/.claude` (adk-split), **NON più in questo repo**.
- `todos/active.md`: priorita' correnti ad alto livello.
- `todos/workflow-architecture-hardening.md`: backlog tecnico operativo su workflow e hardening.
- `docs/tracking/ENGINEERING_WORKLOG.md`: log cronologico delle analisi, verifiche e refactor.
- `docs/tracking/README.md`: spiega quali file di tracking sono canonici.

## Skill e tool preferiti per questo progetto

- Messaggi LinkedIn e outreach B2B: usare skill di copy e psicologia solo quando servono davvero al contenuto.
- Modifiche che toccano browser, timing, stealth, fingerprint, sessione o volumi: fare sempre review anti-ban prima di procedere, se il workflow/skill dedicato e' disponibile.
- Workflow n8n: preferire agenti o skill dedicate all'orchestrazione, non patch manuali casuali sul JSON.
- Debug visivo browser e DOM: usare browser automation o Playwright quando serve evidenza reale, non supposizioni.
- Auth, input utente, query DB, stealth: fare anche scan di sicurezza mirata quando il perimetro lo giustifica.

## Quality gates — zero tolleranza

- Prima di modificare: `npm run pre-modifiche`. Se fallisce, non si parte.
- Dopo le modifiche: `npm run post-modifiche`. Se fallisce, non si dichiara il lavoro finito.
- Prima del commit: `npm run conta-problemi` deve tornare a zero problemi.
- Exit code diverso da zero non va mai trattato come "abbastanza buono".
- `npm run helper-manuali` e' un promemoria: le verifiche manuali richieste vanno eseguite davvero.
- Flusso minimo: pre-modifiche -> sviluppo -> post-modifiche -> conta-problemi -> commit.

## Commit e push — policy operativa esplicita

Regola estratta in `.claude/rules/git-commit-push.md` (path-scoped `**`). Contiene: principi auto-commit/no-auto-push, verifica `audit:git-automation`, enforcement Claude Code + git nativo, trigger auto-push post-commit con precondizioni cumulative, fallback per ambienti senza hook PowerShell (Codex/Cloud Code/Cursor). Modifica lì, non duplicare qui.

## Selezione modello AI per task — regola dura

Regola globale on-demand: `~/.claude/on-demand/model-selection.md` (nudge automatico: `user-prompt-session-advisor.ps1`). Contiene: principio dichiarazione proattiva, contesto router locale, matrice task → modello, condizioni di switch, formato raccomandazione, anti-pattern. Modifica lì, non duplicare qui.

## Priorita' assoluta: anti-ban e anti-detect

Ogni modifica alla codebase del bot deve essere valutata prima di tutto dal punto di vista anti-ban.
La domanda zero e': "questa modifica puo' farci bannare o farci rilevare da LinkedIn?"

Le **6 domande pre-codice/pre-merge** (lista UNICA) e i **9 principi non negoziabili** vivono in
`.claude/rules/browser-antiban.md` (enforced: `pre-edit-antiban.ps1` blocking + skill `/antiban-review`).
La domanda zero qui sopra vale per OGNI task del progetto (anche n8n/docs/config che toccano volumi
o comportamento), non solo per i file nel glob della regola.

## Meta-reasoning — interpretazione, verifica, proattività

Le 11 meta-regole comportamentali (intento non letterale, fallback context degradation, best practice modifica, cross-domain per file, anti-compiacenza, task multi-categoria, pazienza vs fretta, classificazione temporale, blast radius/ordine, contratti/propagazione fallimenti, interpretazione esempi come pattern) sono estratte in `.claude/rules/meta-reasoning.md` (path-scoped `**`). Modifica lì, non duplicare qui.

## Workflow autonomi continui — `/goal`, `/loop`, Stop hook

Regola GLOBALE: `~/.claude/rules/autonomous-workflows.md` (always-on `**`; estratta dal progetto con adk-split, NON è più file locale). Contiene: tabella confronto `/goal` vs `/loop` vs Stop hook, quando usare `/goal` (end state misurabile multi-turno; forma `/goal <keyword>` + binding `~/todos/<keyword>.md`, spec in `~/.claude/GOAL_TASK_BINDING.md`), quando NON usare, comportamento operativo, requisiti, combinazione con auto mode. Modifica lì, non duplicare qui.

### Hook attivi, skill pre/post-conditions, hook n8n futuri

Inventory completo (command hook attivi — conteggio derivato dal canonico `MANAGED_ROUTER_HOOKS` in `~/.claude/scripts/model-router-config.mjs`, non hardcodato — + tabella pre/post-conditions skill/MCP + roadmap hook n8n) in `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`. Pattern file sensibili LinkedIn nei matcher PreToolUse e regole anti-ban in `.claude/rules/browser-antiban.md` + `.claude/rules/workflow-linkedin.md`. Modifica lì, non duplicare qui.

## Workflow obbligatorio per questo progetto

Regola estratta in `.claude/rules/workflow-linkedin.md` (path-scoped `src/**`, `n8n-workflows/**`). Contiene: classificazione task (quick fix / bug bot / feature-modifica bot / refactor-infra), 6 passi obbligatori (pre-modifica → review antiban → planning → impl → verifica → commit), estensioni L1-L9 LinkedIn delta (35 sub-check su L1, L3, L4, L5, L6, L7, L8, L9). Modifica lì, non duplicare qui.

## Cambio chat e continuita' — Obsidian come vista operativa

Fonte UNICA per ripartire in nuova chat: **`/lastchat`** (legge il file per-progetto `~/.claude/lastchat/<slug-cwd>.md`, fallback legacy `~/.claude/LASTCHAT.md`). Per salvare prima di chiudere/compattare: **`/lastchat save`**.

`C:\Users\albie\memory\` (memoria) e `C:\Users\albie\todos\active.md` (priorità) restano fonti di stato/priorità, NON il sistema di continuità chat. Obsidian `Resources/continuita/` è vista navigabile (proiezione), non procedura.

**ELIMINATI (2026-06-07, regola forte)**: `.claude/CONTINUATION.md`, `SESSION_HANDOFF.md`, `.claude/SESSION_PROMPT.md` e skill `resume-context`. La continuità è **UN SOLO sistema = LASTCHAT** (`~/memory/decisions_secondo_cervello.md`). Gli hook `session-start-continuation` / `pre-compact-handoff` puntano a LASTCHAT; `post-bash-handoff-invalidate` disattivato.

**Quando salvare** (`/lastchat save`): ctx alto, fine sessione lunga, compact imminente, cambio tema, prima di nuova chat.

## Loop di completamento

- Un task non va considerato concluso finche' non ha superato L9 (loop finale di completezza) sui file toccati direttamente e indirettamente — vedi definizione in `~/.claude/CLAUDE.md`.
- Se il task si ferma per conferma utente, limiti operativi o crediti, l'agente deve lasciare stato, blocco e prossimi passi in modo esplicito.
- Alla fine di ogni blocco operativo, completare tutto il completabile nel turno corrente e lasciare sempre continuita' operativa: prossimo passo concreto, blocco reale o domanda specifica. Niente chiusure passive se esiste un'azione successiva ragionevole.
- Prima di chiudere il task l'AI deve anche verificare che nessun obbligo di breve termine sia stato spinto impropriamente su medio/lungo termine e che i follow-up reali siano stati tracciati in modo esplicito.
- A fine ogni blocco tecnico significativo: aggiornare `docs/tracking/ENGINEERING_WORKLOG.md` con data, tema, interventi effettuati e verifica finale.

## Nuovi progetti e bootstrap preventivo

- Quando nasce un progetto nuovo, o quando si vuole riallineare un progetto esistente, usare la checklist in [docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md).
- La checklist deve coprire non solo il setup iniziale, ma anche prevenzione tecnica, affidabilita' AI, ambienti, quality gates, rischio dominio, handoff e lungo termine.
- Se un nuovo progetto parte senza questa baseline, il rischio di debito tecnico, contesto implicito e drift operativo cresce subito.
