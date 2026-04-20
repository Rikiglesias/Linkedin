# Document Index

Questo file classifica la documentazione della repo per ridurre ambiguita' e duplicazioni.
Non tutti i documenti hanno lo stesso ruolo: alcuni sono canonici, altri sono guide operative, altri sono analisi profonde o storico.

## Documenti canonici

- [README.md](/C:/Users/albie/Desktop/Programmi/Linkedin/README.md)
  Overview tecnica del progetto e punto di ingresso generale.
- [AGENTS.md](/C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)
  Regole operative canoniche per agenti AI e sessioni tool-driven.
- [CLAUDE.md](/C:/Users/albie/Desktop/Programmi/Linkedin/CLAUDE.md)
  Adapter breve per Claude Code.
- [AI_MASTER_SYSTEM_SPEC.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md)
  Lista madre unica, esplicita e non duplicata del sistema AI desiderato.
- [AI_MASTER_IMPLEMENTATION_BACKLOG.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md)
  Fonte primaria unica del "cosa manca ancora" rispetto alla spec completa.
- [AI_IMPLEMENTATION_LIST_GLOBAL.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_IMPLEMENTATION_LIST_GLOBAL.md)
  Backlog lineari item AI/globali (control plane, memoria, parita' ambienti, git, autonomia).
- [LINKEDIN_IMPLEMENTATION_LIST.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/LINKEDIN_IMPLEMENTATION_LIST.md)
  Backlog lineari item LinkedIn-specifici (runtime, anti-ban, proxy, n8n, compliance).
- [AI_RUNTIME_BRIEF.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_RUNTIME_BRIEF.md)
  Digest runtime compatto caricato dai hook prima dei prompt e prima della compattazione; non sostituisce i canonici, ma li rende richiamabili in modo affidabile.
- [AI_OPERATING_MODEL.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md)
  Roadmap esplicita su prompt, modelli, skill, agenti, workflow e automazioni.
- [NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md)
  Checklist 360 gradi riusabile per bootstrap, prevenzione tecnica e handoff di nuovi progetti.
- [tracking/README.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/README.md)
  Regole del tracking tecnico.
- [tracking/ENGINEERING_WORKLOG.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md)
  Log cronologico delle verifiche tecniche reali.
- [active.md](/C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md)
  Priorita' correnti.
- [workflow-architecture-hardening.md](/C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md)
  Backlog tecnico operativo.

## Cluster anti-ban e sicurezza

Questi file sembrano simili, ma non devono essere usati per lo stesso scopo:

- [GUIDA_ANTI_BAN.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/GUIDA_ANTI_BAN.md)
  Guida operativa per l'operatore umano.
- [ARCHITECTURE_ANTIBAN_GUIDE.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/ARCHITECTURE_ANTIBAN_GUIDE.md)
  Reference tecnica di implementazione anti-ban/stealth.
- [SECURITY.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/SECURITY.md)
  Hardening, privacy, routine di sicurezza e controlli.
- [THREAT_MODEL.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/THREAT_MODEL.md)
  Threat model formale.

## Cluster workflow

- [WORKFLOW_ENGINE.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/WORKFLOW_ENGINE.md)
  Contratto canonico del motore workflow lato backend.
- [WORKFLOW_MAP.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/WORKFLOW_MAP.md)
  Guida operativa ai workflow lato utente/operatore.
## Configurazione e integrazioni

- [CONFIG_REFERENCE.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/CONFIG_REFERENCE.md)
  Riferimento tecnico delle variabili.
- [INTEGRATIONS.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/INTEGRATIONS.md)
  Integrazioni esterne e payload.

## Sidecar e supporto

- [dashboard/README.md](/C:/Users/albie/Desktop/Programmi/Linkedin/dashboard/README.md)
  Sotto-progetto separato per dashboard task/TODO su Supabase. Non coincide con la control room principale servita dal backend del bot.
- [n8n/README.md](/C:/Users/albie/Desktop/Programmi/Linkedin/n8n/README.md)
  Note operative per import e setup workflow n8n.
- [plugins/README.md](/C:/Users/albie/Desktop/Programmi/Linkedin/plugins/README.md)
  SDK minimale dei plugin runtime.
- [scripts/README.md](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/README.md)
  Classificazione degli script tra canonici, manuali e sidecar.

## Storico, analisi e documenti specialistici

- [AI_DOC_STYLE_GUIDE.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_DOC_STYLE_GUIDE.md)
  Style guide per documenti AI-readable: come scrivere e strutturare i file per massimizzare comprensione e retrieval.
- [AI_QUALITY_PIPELINE.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_QUALITY_PIPELINE.md)
  Documento specialistico sulla pipeline di qualita' AI.
- [tracking/codebase-debt.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/codebase-debt.md)
  Snapshot del debito tecnico e dei monoliti da splittare al prossimo tocco.
## Archivio

- [archive/todo-audit-archive-2026-04-03.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/todo-audit-archive-2026-04-03.md)
  Audit monolitico storico, non backlog operativo vivo.
- [archive/antiban-operational-rollout-legacy.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/antiban-operational-rollout-legacy.md)
  Checklist legacy di rollout/campagna rimossa dal documento tecnico anti-ban.
- [archive/360-analysis-plan-2026-04-04.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/360-analysis-plan-2026-04-04.md)
  Piano generato da analisi parallela, utile come storico ma non come backlog attivo.
- [archive/workflow-analysis-archive-2026-04.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/workflow-analysis-archive-2026-04.md)
  Analisi tecnica workflow archiviata (aprile 2026).
- [archive/a16-linkedin-dependency-plan-archive.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/a16-linkedin-dependency-plan-archive.md)
  Piano A16 dependency risk LinkedIn archiviato.
- [archive/2026-04-01-runtime-core-repository-refactor-design.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/2026-04-01-runtime-core-repository-refactor-design.md)
  Spec di refactor runtime/core archiviata (aprile 2026).
- [archive/engineering-worklog-archive-2026-04.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/engineering-worklog-archive-2026-04.md)
  Worklog tecnico storico aprile 2026 (entries pre-18 aprile).

## Root e cartelle da non pulire alla cieca

- `.agents`, `.claude`, `.windsurf`: contengono skill e mirror tool-managed. Possibili duplicazioni, ma non cancellare senza audit dedicato.
- `coverage`, `dist`, `logs`, `data`: artefatti runtime o build. Valutare policy, non cancellare automaticamente durante cleanup documentale.
- `%SystemDrive%`: se compare nel repo, trattarlo come artefatto anomalo e verificare prima dell'eliminazione.

## Regola di cleanup

- Prima chiarire il ruolo del documento.
- Poi decidere se e' canonico, operativo, storico o duplicato.
- Solo dopo valutare merge, archiviazione o eliminazione.
- Niente eliminazioni cieche su file sporchi, non tracciati o tool-managed.
