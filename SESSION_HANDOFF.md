# SESSION_HANDOFF — 2026-05-16

## Scopo Del File

Questo file serve a trasferire il contesto operativo a una nuova chat senza costringere Riccardo a rispiegare tutto.

Ultima validazione reale: nuova sessione Codex del 2026-05-11 avviata con prompt `resume`. La sessione ha letto memoria globale, questo handoff, AGENTS e canonici indicati, ricostruendo obiettivi, stato, blocchi e prossimi passi senza input aggiuntivo dell'utente.

Aggiornamento 2026-05-16: ripresa reale da contesto chat vecchia corretta dall'utente. Sono stati riallineati `.claude/SESSION_PROMPT.md` e `.claude/CONTINUATION.md`, completato l'audit best practice AI categorie 9-13, corretti i wrapper scheduler `.bat`, ignorato `data/restore-drill/`, ripulita la struttura memory/frontmatter e splittato `ENGINEERING_WORKLOG.md` sotto hard limit.

Non e' un diario completo. Deve dire:
- cosa si stava facendo
- cosa e' stato verificato davvero
- cosa e' ancora aperto
- quali file sono coinvolti
- quale ordine seguire dopo
- quali punti non vanno trattati come gia' chiusi

## File Da Leggere Nella Nuova Chat

1. `AGENTS.md` — regole operative del repo e quality gate.
2. `docs/AI_MASTER_SYSTEM_SPEC.md` — sistema AI desiderato completo.
3. `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` — backlog madre dei punti ancora aperti.
4. `docs/AI_RUNTIME_BRIEF.md` — digest runtime reiniettato dai hook.
5. `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md` — decisione su hook necessari e promozioni future.
6. `docs/tracking/ENGINEERING_WORKLOG.md` — stato tecnico verificato.
7. `todos/active.md` — priorita' operative repo.
8. `C:\Users\albie\todos\active.md` — priorita' globali utente.
9. `C:\Users\albie\memory\user.md`, `personality.md`, `preferences.md`, `decisions.md` — memoria globale.

## Obiettivi Correnti

- Rendere il sistema AI piu' autonomo e meno dipendente dalla memoria del modello.
- Evitare che Claude/Codex prendano gli esempi dell'utente come lista chiusa invece di inferire il pattern generale.
- Far scegliere automaticamente fonte di verita', skill, MCP, plugin, hook, script, audit, web search, modello, ambiente e loop quando servono.
- Capire quali regole devono diventare hook e quali devono restare skill/audit/runtime brief.
- Rendere il trasferimento del contesto in nuova chat un punto operativo vero, non una nota generica.
- Dopo questo blocco, tornare ai blocker LinkedIn Bot: lifecycle, control plane, workflow truthfulness, proxy/session classification, staging reale.

## Decisioni Prese

- Non servono altri hook generici adesso. Il numero operativo attuale e' **22 hook logici**; nuovi blocking hook vanno aggiunti solo dopo miss ricorrenti misurati.
- `UserPromptSubmit` e' il punto corretto per iniettare contesto visibile al modello.
- `PreToolUse` e' corretto per bloccare azioni ad alto rischio, non per insegnare regole generiche.
- `PreCompact` va usato per proteggere il contesto prima del compact e proporre/forzare handoff quando serve.
- `context-handoff` e `session-prompt` devono restare distinti:
  - `context-handoff` = handoff operativo dettagliato.
  - `session-prompt` = prompt copiabile per nuova chat.
- Il trasferimento chat vecchia -> chat nuova ha una prima prova reale passata in Codex (2026-05-11), ma resta da mantenere contro drift/staleness e da verificare quando si rigenera `.claude/SESSION_PROMPT.md`.
- `post-bash-auto-push.ps1:117` non e' piu' un blocker aperto: lo script versionato parsea con `pwsh` e `powershell`, e non e' presente negli hook globali attivi.

## Blast Radius Identificato

### File repo modificati direttamente

- `SESSION_HANDOFF.md` — riscritto per diventare handoff operativo, non racconto generico.
- `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` — reso piu' esplicito il punto sulla continuita' chat vecchia -> nuova.
- `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` — aggiunto item aperto dedicato alla validazione reale del cambio chat; corretto il falso completato.
- `todos/active.md` — priorita' sprint aggiornata con cambio chat e `SESSION_HANDOFF.md` / `SESSION_PROMPT.md`.
- `docs/AI_RUNTIME_BRIEF.md` — rafforzato con ledger, esempi come pattern, web policy, capability gap, blast radius, context degradation, chiusura L1-L9.
- `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md` — nuovo piano hook: cosa e' hook, cosa no, quando promuovere.
- `docs/tracking/AI_CAPABILITY_ROUTING.json` — aggiunte capability `context-handoff` e `session-prompt`.
- `docs/tracking/ENGINEERING_WORKLOG.md` — aggiunta entry del blocco control plane AI.
- `src/scripts/aiControlPlaneAudit.ts` — fix audit hook runtime brief con argomenti posizionali.
- `src/scripts/hooksConformityAudit.ts` — fix audit hook runtime brief con argomenti posizionali.
- `src/scripts/lib/aiControlPlaneRegistry.ts` — supporto capability `plugin`, `agent`, `cli` e source `session-state`.

### Aggiornamento ripresa 2026-05-11 / 2026-05-16

- `SESSION_HANDOFF.md` — aggiornato per rimuovere blocchi git stale e registrare la prova reale di ripresa.
- `.claude/SESSION_PROMPT.md` — file ignorato da git, da rigenerare con stato corrente quando serve passare una chat nuova.
- `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `todos/active.md`, `docs/tracking/ENGINEERING_WORKLOG.md` — da tenere allineati alla prova di ripresa.
- `docs/tracking/AI_BEST_PRACTICE_AUDIT_2026-05.md` — categorie 9-13 completate nel blocco 2026-05-16.
- `scripts/run-audit-weekly.bat`, `scripts/run-audit-monthly.bat` — ora propagano exit code e usano datestamp robusto.
- `.gitignore` — ora ignora `data/restore-drill/`.
- `docs/tracking/ENGINEERING_WORKLOG_2026-04.md` — archivio mensile creato per ridurre il worklog corrente.

### File globali/non versionati rilevanti

- `C:\Users\albie\.claude\skills\context-handoff\skill.md` — skill ripristinata.
- `C:\Users\albie\todos\active.md` — nota stale su `post-bash-auto-push.ps1:117` chiusa.

### File da non includere in commit cieco

- `WhatsApp Image 2026-05-06 at 23.43.12*.jpeg` — 6 immagini untracked in root.

## Stato Implementazione

### Fatto e verificato

- Runtime brief ora copre:
  - requirement ledger
  - esempi come pattern da estendere
  - no hallucination / no false completion
  - web search obbligatoria quando serve
  - capability gap
  - blast radius
  - context degradation
  - chiusura L1-L9
- Audit hook corretti: non producono piu' falso negativo se il comando PowerShell usa argomento posizionale.
- Routing registry valido con capability `agent`, `cli`, `plugin`, `context-handoff`, `session-prompt`.
- Skill `context-handoff` ripristinata e verificata dagli audit.
- Piano hook scritto: 22 hook logici attuali, promozioni future solo su miss ricorrenti.
- Punto "trasferire contesto in un'altra chat" ora e' aperto in modo esplicito nella lista operativa, non solo disperso nei canonici.

### Fatto e validato una prima volta

- Trasferimento chat vecchia -> chat nuova:
  - il meccanismo esiste
  - il template esiste
  - l'handoff e' stato riscritto
  - una nuova sessione Codex (2026-05-11) e' ripartita da `resume`, memoria globale, `SESSION_HANDOFF.md` e canonici indicati senza chiedere contesto aggiuntivo

### Non chiuso

- Protezione anti-staleness del prompt: `.claude/SESSION_PROMPT.md` esiste ma e' ignorato da git e puo' diventare stale se non rigenerato.
- Commit/push del blocco corrente: branch `main` allineato a `origin/main` su `99c9eb5`; working tree iniziale sporco solo per 6 immagini WhatsApp untracked in root.
- Briefing mattutino: ancora da configurare.
- Plugin L5: manifesto presente, manca install script robusto.
- LinkedIn Bot production blockers: lifecycle, control plane, workflow truthfulness, proxy/session classification, staging reale.
- n8n: workflow chiave da importare/attivare e placeholder/credenziali da sostituire.

## Verifiche Completate

- `npm run pre-modifiche` — verde.
- `npm run post-modifiche` — verde.
- Typecheck backend/frontend — verde.
- ESLint — verde.
- Vitest — 137 file test passati, 1430 test passati.
- `npm run audit:hooks` — 14/14.
- `npm run audit:ai-control-plane` — 21/21 + routing + L2-L9 verdi.
- `npm run audit:rule-enforcement` — 29/42 enforced, 0 gap meccanizzabili.
- `npm run audit:ledger` — 14/14.
- `npm run audit:routing` — registry valido, 36 capability, 15 domini.
- `npm run audit:skills` — 5/5 skill critiche.
- `git diff --check` — verde.
- `npm run pre-modifiche` — verde il 2026-05-11: typecheck backend/frontend, ESLint e 1430 test Vitest passati.
- `npm run post-modifiche` — verde il 2026-05-11: typecheck backend/frontend, ESLint e 1430 test Vitest passati.
- `npm run audit:ai-control-plane` — verde il 2026-05-11.
- `npm run conta-problemi` — verde il 2026-05-11: typecheck backend/frontend, ESLint e 1430 test Vitest passati.

## Blocchi Aperti

1. **Handoff nuova chat validato una prima volta, ma da proteggere contro staleness**
   - Prova passata: nuova sessione Codex 2026-05-11 con prompt `resume`.
   - Problema trovato: `.claude/SESSION_PROMPT.md` era stale rispetto al commit corrente e ai blocchi reali.
   - Azione corretta: rigenerare il prompt quando serve, e mantenere `SESSION_HANDOFF.md` come fonte operativa tracked.

2. **Working tree con materiale esterno non correlato**
   - Branch `main` e `origin/main` sono allineati su `99c9eb5`.
   - Restano 6 immagini WhatsApp untracked in root.
   - Non includerle in commit ciechi; trattarle come input esterno gia' analizzato o da archiviare con decisione separata.

3. **Sistema AI ancora non completamente autonomo**
   - Oggi i gap meccanizzabili sono 0, ma 13 controlli restano non meccanizzabili by design.
   - Serve misurare miss reali da log prima di promuovere altri hook.
   - Il prossimo hardening deve basarsi su evidenza, non su altri promemoria generici.

## Prossimi Passi Ordinati

1. Chiudere l'allineamento della prova di ripresa:
   - aggiornare `.claude/SESSION_PROMPT.md` con stato corrente quando serve una nuova chat
   - aggiornare backlog/worklog con la prova 2026-05-11
   - committare solo i file tracked del blocco handoff/docs, escludendo le immagini WhatsApp

2. Commit del blocco AI:
   - includere solo file docs/handoff collegati al control plane e alla validazione ripresa
   - escludere immagini WhatsApp
   - valutare push solo dopo `audit:git-automation`

3. Configurare briefing mattutino:
   - definire canale/tool
   - leggere `C:\Users\albie\todos\active.md`
   - produrre 3 priorita' ogni mattina

4. Continuare LinkedIn Bot production blockers:
   - lifecycle shutdown/flush
   - runtime truthfulness API/Telegram/report/dashboard
   - proxy/session classification
   - staging con browser/proxy/account reali

5. n8n:
   - importare workflow chiave
   - sostituire placeholder
   - verificare alert/report reali

## Prompt Minimo Per Nuova Chat

```text
Leggi prima C:\Users\albie\Desktop\Programmi\Linkedin\SESSION_HANDOFF.md.
Poi leggi AGENTS.md e i file indicati nella sezione "File Da Leggere Nella Nuova Chat".
Obiettivo: riprendere il lavoro senza chiedermi di rispiegare il contesto.
Prima di agire, dimmi:
1. obiettivo corrente
2. stato reale
3. blocchi aperti
4. prossimi passi ordinati
5. cosa non e' ancora verificato
```
