# SESSION_HANDOFF — 2026-05-07

## Scopo Del File

Questo file serve a trasferire il contesto operativo a una nuova chat senza costringere Riccardo a rispiegare tutto.

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
- Il trasferimento chat vecchia -> chat nuova e' **parziale**, non chiuso: esiste il meccanismo, ma va validata la qualita' reale del contenuto.
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

### Fatto ma ancora da validare end-to-end

- Trasferimento chat vecchia -> chat nuova:
  - il meccanismo esiste
  - il template esiste
  - l'handoff e' stato riscritto
  - manca ancora test reale con nuova chat che legga solo handoff + canonici indicati e riparta senza omissioni

### Non chiuso

- Commit/push del blocco corrente: non automatico per working tree misto, branch `main` ahead 1 e immagini untracked.
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

## Blocchi Aperti

1. **Handoff nuova chat non ancora validato end-to-end**
   - Serve aprire una nuova chat o simulare una ripartenza.
   - La nuova chat deve leggere solo questo file e i canonici indicati.
   - Deve ricostruire obiettivi, stato, blocchi, file modificati e prossimi passi senza chiedere a Riccardo di rispiegare.
   - Se fallisce, correggere template `context-handoff` e `session-prompt`.

2. **Working tree non pronto per commit automatico**
   - Branch `main` ahead 1 rispetto a `origin/main`.
   - Working tree contiene modifiche repo + 6 immagini untracked.
   - `audit:git-automation` richiede review dello scope prima di commit/push.

3. **Sistema AI ancora non completamente autonomo**
   - Oggi i gap meccanizzabili sono 0, ma 13 controlli restano non meccanizzabili by design.
   - Serve misurare miss reali da log prima di promuovere altri hook.
   - Il prossimo hardening deve basarsi su evidenza, non su altri promemoria generici.

## Prossimi Passi Ordinati

1. Validare il trasferimento in nuova chat:
   - generare/controllare `SESSION_PROMPT.md`
   - aprire nuova chat
   - far leggere questo handoff + canonici indicati
   - verificare se la nuova chat riparte correttamente
   - correggere template/skill se manca dettaglio

2. Separare commit del blocco AI:
   - includere solo file docs/src collegati al control plane e handoff
   - escludere immagini WhatsApp
   - verificare se `SESSION_HANDOFF.md` va nello stesso commit o in commit docs separato

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
