# AI Orchestrator Contract

> Contratto operativo per il sistema AI globale: ragionamento, scelta delle primitive, hook e completamento veritiero.
> Questo file non sostituisce `AGENTS.md` o `docs/AI_RUNTIME_BRIEF.md`: rende auditabile il comportamento che i hook devono reiniettare e che gli audit devono controllare.

## Scope

Questo contratto riguarda solo il control plane AI globale:

- ragionamento obbligatorio prima di agire;
- selezione automatica di skill, MCP, plugin, modello, ambiente, web/docs e audit;
- copertura hook per sessione, prompt, tool, compattazione e chiusura;
- handoff/cambio chat e continuita' operativa;
- dichiarazione veritiera di DONE / PARTIAL / BLOCKED.

Non governa in dettaglio il runtime LinkedIn, la produzione n8n, Whisper, problemi del computer o logiche applicative specifiche. Quei domini restano nei rispettivi backlog, ma devono ereditare questo contratto quando l'AI li modifica.

## Trigger

Il contratto si attiva per ogni task non banale, e sempre quando compare almeno uno di questi segnali:

- prompt lungo, vocale, ambiguo o multi-punto;
- richiesta di migliorare "l'intelligenza", gli hook, le skill, gli automatismi o l'autonomia;
- esempi dell'utente che indicano un pattern piu' ampio;
- modifiche a file, regole, skill, hook, audit, workflow o memoria;
- task che puo' dipendere da stato reale, API, provider, librerie, policy o best practice aggiornabili;
- cambio chat, contesto degradato o rischio di perdere stato.

## Contratto Operativo

1. **Intento reale prima del testo letterale**: normalizzare dettato, errori fonetici, ambiguita' e riferimenti come "quello di prima". Se il testo dice X ma il contesto prova Y, dichiarare Y e procedere su Y.
2. **Input utente come ipotesi**: trattare ogni affermazione operativa come ipotesi da verificare contro repo, memoria, docs ufficiali, MCP/tool live o web quando serve. Non prendere per vero uno stato non verificato.
3. **Esempi come pattern**: gli esempi non sono una lista chiusa. Estrarre il principio e cercare casi analoghi, correlati e indiretti.
4. **Decomposizione ricorsiva**: trasformare l'argomento in albero con sottopunti e sotto-sottopunti. Per ogni ramo decidere fonte, rischio, capability, verifica e done criteria.
5. **Root cause prima del workaround**: identificare problema reale, cause probabili, alternative ragionevoli e criterio della soluzione scelta. Un workaround puo' essere accettato solo se dichiarato temporaneo e tracciato.
6. **Fonte di verita corretta**: repo/test/log/config per fatti interni; docs ufficiali/web per API, provider e best practice mutevoli; MCP/tool live per stato esterno reale; memoria solo per preferenze, decisioni e stato non derivabile.
7. **Capability routing automatico**: scegliere skill, MCP, plugin, script, audit, subagent, loop, goal o workflow persistente senza aspettare che l'utente lo ricordi. Se manca la primitive giusta, dichiarare il gap e proporre skill/hook/audit/workflow invece di improvvisare.
8. **Modello e ambiente**: valutare qualita', costo, velocita', contesto, tool disponibili e rischio. Dichiarare cambio modello/ambiente solo quando incide sul lavoro.
9. **Blast radius L2-L9**: per codice o documenti canonici, controllare file diretti, file indiretti, import/export, caller, test, config, registry, memoria e documentazione collegata. L1 e' bloccante; L2-L9 sono proporzionati al rischio.
10. **Cross-domain per ogni file**: ogni file toccato va rivalutato almeno su sicurezza, architettura, performance/timing, compliance, osservabilita' e dominio applicativo. Per LinkedIn aggiungere anti-ban.
11. **Traccia operativa osservabile**: i passaggi non devono restare solo nella chat. Quando un comportamento deve essere ricordato o verificato, promuoverlo a canonico, checklist, skill, hook, script/audit o workflow persistente.
12. **Truthful completion**: non dichiarare completato senza prove. Se resta un limite, dire PARTIAL o BLOCKED con causa, verifica mancante e prossimo passo esatto.

## Traccia Operativa Osservabile

Per task densi o multi-file, l'AI deve poter ricostruire questi campi nel report, nel worklog, nel handoff o negli audit:

- `intent`: intento reale normalizzato;
- `assumptions`: assunzioni rilevanti e come sono state verificate;
- `sources`: fonte di verita usata e fonti escluse;
- `capabilities`: skill/MCP/plugin/script/audit/modello scelti o esclusi;
- `directFiles`: file toccati direttamente;
- `indirectFiles`: file, registry, test, hook o docs impattati indirettamente;
- `crossDomains`: domini controllati per ogni file;
- `verification`: comandi, audit, test o controlli manuali eseguiti;
- `completion`: DONE / PARTIAL / BLOCKED, prove e prossimo passo.

## Hook Coverage

Copertura minima richiesta:

| Evento | Responsabilita' |
| --- | --- |
| `SessionStart` | caricare memoria critica, todo attivi, runtime brief, continuation e contratto orchestrator |
| `UserPromptSubmit` | reiniettare P0, intent verification, skill/capability routing, model suggestion e commit gate |
| `PreToolUse` | bloccare o avvisare su edit rischiosi, segreti, best practice, comandi shell e git |
| `PostToolUse` | registrare effetti, controllare checklist post-edit, codebase hygiene, websearch log e quality log |
| `PreCompact` | generare o aggiornare handoff prima di perdere contesto |
| `Stop` | impedire false completion, ricordare prossimo passo, commit gate e session log |

Codex desktop/CLI deve avere parity minima tramite `.codex/hooks.json`. Se un evento non esiste in Codex, va documentato il gap e va usato il sostituto piu' vicino. Al 2026-05-17 `PreCompact` non ha equivalente diretto in Codex: il gap va coperto con `Stop` + continuation/handoff audit.

## Non Goals

- Non trasformare il ragionamento in loop infinito.
- Non chiedere conferma per ogni azione banale.
- Non salvare in memoria codice o informazioni gia' derivabili dal repo.
- Non bypassare conferme richieste per azioni distruttive, sicurezza, dati o produzione.
- Non confondere documentazione statica con enforcement reale: se manca hook/script/test, e' solo advisory.

## Done Criteria

Questo contratto e' considerato operativo solo quando:

- `docs/AI_RUNTIME_BRIEF.md` lo cita come digest applicativo;
- `AGENTS.md` lo elenca tra i canonici da mantenere allineati;
- `package.json` espone audit dedicati;
- `npm run audit:ai-reasoning-hardening` passa;
- `npm run audit:codex-hook-parity` passa;
- `.claude/CONTINUATION.md` non contiene placeholder `TODO: [AI: ...]`;
- ogni nuovo gap viene tracciato in `docs/tracking/AI_GOAL_QUEUE.md` o nel backlog canonico corretto.
