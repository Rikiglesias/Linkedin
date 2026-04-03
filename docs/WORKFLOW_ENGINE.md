# Workflow Engine

> Stato documento: contratto canonico del motore workflow backend.
> Per la guida utente ai workflow usare `WORKFLOW_MAP.md`.
> Per l'analisi tecnica estesa usare `WORKFLOW_ANALYSIS.md`.

Questo documento descrive il contratto stabile del nuovo motore workflow backend.
CLI, API automation e frontend futuro devono usare questo livello e non ricostruire logica operativa o anti-ban lato client.

## Workflow supportati

- `sync-search`
- `sync-list`
- `send-invites`
- `send-messages`

## Principio operativo

- Il motore workflow espone service tipizzati sotto `src/workflows/services/`.
- Gli adapter CLI sotto `src/workflows/*.ts` si limitano a:
  - passare input
  - mostrare preview/report
  - inviare reporting best-effort
- Le guardie anti-ban autoritative stanno nel core:
  - `src/core/workflowEntryGuards.ts`
  - `src/core/orchestrator.ts`

Nessun client deve duplicare regole di:

- quarantina
- pausa automazione
- working hours
- selector failure burst
- run error burst
- canary selectors
- compliance stop
- cooldown/risk stop

## Request domain

I service usano `WorkflowExecutionRequest` e varianti specifiche in:

- `src/workflows/types.ts`

Campi supportati:

- account
- lista
- limiti
- dry-run
- enrichment
- note/message mode
- minScore
- noProxy
- interactive
- skipPreflight

## Result domain

Ogni workflow pubblico restituisce un `WorkflowExecutionResult` con shape stabile:

- `workflow`
- `success`
- `blocked`
- `summary`
- `errors`
- `nextAction`
- `riskAssessment`
- `artifacts`

### `blocked`

Quando presente, indica che il workflow e' terminato senza eseguire la parte operativa.

Reason attualmente usate:

- `USER_CANCELLED`
- `PRECONDITION_FAILED`
- `NO_WORK_AVAILABLE`
- `ACCOUNT_QUARANTINED`
- `AUTOMATION_PAUSED`
- `SESSION_VARIANCE_SKIP_DAY`
- `DISK_CRITICAL`
- `OUT_OF_HOURS`
- `SELECTOR_FAILURE_BURST`
- `RUN_ERROR_BURST`
- `SELECTOR_CANARY_FAILED`
- `COMPLIANCE_HEALTH_BLOCKED`
- `RISK_STOP_THRESHOLD`
- `AI_GUARDIAN_PREEMPTIVE`
- `RISK_COOLDOWN`
- `LOGIN_REQUIRED`
- `WORKFLOW_ERROR`

## Artifacts

Internamente `artifacts` contiene solo dati di supporto al rendering o al polling:

- `preflight`
- `previewLeads`
- `estimatedMinutes`
- `candidateCount`
- `report`
- `extra`

Il frontend non deve dipendere da campi sperimentali in `extra` senza prima promuoverli nel contratto esplicito.

### Contratto pubblico API/frontend

L'API v1 non espone `artifacts.extra`.
I client ricevono un read-model pubblico stabile derivato da `WorkflowExecutionResult`:

- `workflow`
- `success`
- `blocked`
- `summary`
- `errors`
- `nextAction`
- `riskAssessment`
- `artifacts.preflight` come summary ridotto:
  - `confirmed`
  - `selectedAccountId`
  - `warningCount`
  - `criticalWarningCount`
  - `riskAssessment`
  - `hasAiAdvice`
- `artifacts.previewLeads`
- `artifacts.estimatedMinutes`
- `artifacts.candidateCount`
- `artifacts.report`

Questo permette al frontend di renderizzare stato, preview e next action senza dipendere da shape interne instabili.

## API e polling

L'API automation salva e restituisce lo stesso result shape tramite:

- `POST /api/v1/automation/commands`
- `GET /api/v1/automation/commands/:requestId`
- `GET /api/v1/automation/commands`

Per i workflow pubblici il `result_json` deve essere trattato come `WorkflowExecutionResult`.
Per l'esposizione HTTP usare il read-model pubblico in `src/api/helpers/automationReadModel.ts`.

## Sicurezza lato UI

Azioni sicure lato UI:

- creare comandi automation
- leggere snapshot/stato/result
- visualizzare preview, warning, report, next action

Azioni non sicure lato UI:

- decidere se un workflow puo' bypassare guardie anti-ban
- applicare logica di compliance o cooldown lato frontend
- parlare direttamente con LinkedIn
- pilotare browser/sessioni

## Compatibilita'

- CLI legacy mantenuta tramite adapter sottili
- dispatcher automation allineato ai service
- `trigger-run` legacy resta un adapter verso la command pipeline

## Estensioni future

Prima di aggiungere nuovi workflow:

1. aggiungere request/result tipizzati in `src/workflows/types.ts`
2. implementare service puro in `src/workflows/services/`
3. aggiungere adapter CLI minimo
4. allineare dispatcher automation
5. aggiungere test di contratto
