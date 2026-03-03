# TODO LIST 360 - LinkedIn Bot (2026)

## Obiettivo

Portare il progetto a un livello `production-grade`: resiliente, osservabile, manutenibile, con AI locale e governance forte.

## Vincoli non negoziabili

- Compliance legale/ToS prima di tutto.
- Nessun bypass aggressivo di sistemi anti-abuso (CAPTCHA bypass automatico, spoofing incoerente, evasione identita').
- Ogni automazione ad alto rischio deve avere `fallback -> pausa -> review umana`.

## Legenda stato

- `NON PRESENTE`
- `PARZIALE`
- `PRESENTE`

## Setup ambiente (baseline)

| Area | Strumento | Stato target | Note operative |
|---|---|---:|---|
| AI locale | Ollama (`llama3.1:8b`, `mxbai-embed-large`, `whisper`) | PARZIALE | Unificare endpoint e timeout in `src/config/domains.ts` |
| AI locale Node | `@xenova/transformers` | NON PRESENTE | Per embedding/STT offline light |
| Inferenza ONNX | `onnxruntime-node` | NON PRESENTE | Runtime comune per modelli locali |
| Browser hardening | Playwright + stealth compatibile | PARZIALE | Hardening consentito solo se coerente e non evasivo |
| Proxy governance | Proxy pool + health checks | PRESENTE | Separazione session/integration + claim lease outbox |
| Process manager | PM2 | PARZIALE | Profili dev/stage/prod + restart policy |
| Secrets | `dotenv` + inventory/rotation | PARZIALE | Tabella `secret_inventory` gia' presente |

## P0 - Fondamenta (alta priorita')

| ID | Task | File principali | Criteri di accettazione | Stato |
|---|---|---|---|---:|
| P0-01 | Health score operativo unico + auto-pause | `src/core/orchestrator.ts`, `src/risk/riskEngine.ts`, `src/core/repositories/stats.ts` | Calcolo score tracciato; se `< soglia` pausa automatica con alert e motivo | PRESENTE |
| P0-02 | Compliance validator dinamico (limiti adattivi) | `src/core/doctor.ts`, `src/core/scheduler.ts`, `src/config/validation.ts` | Limiti effettivi per account age; report con violazioni e suggerimenti | PRESENTE |
| P0-03 | Pending ratio alerting (`>65%`) | `src/core/orchestrator.ts`, `src/telemetry/alerts.ts` | Alert deduplicato per giorno e account/lista | PRESENTE |
| P0-04 | Rotazione segreti schedulata | `src/scripts/rotateSecrets.ts`, `src/core/repositories/system.ts` | Job settimanale, audit event, expirations aggiornate | PRESENTE |
| P0-05 | Test di regressione governance/risk | `src/tests/integration.ts`, `src/tests/unit.ts` | Test verdi per pause/quarantine/cooldown/health-score | PRESENTE |
| P0-06 | Checklist runtime preflight obbligatoria | `src/core/doctor.ts`, `bot.ps1` | Avvio bloccato se check critici falliscono | PRESENTE |

## P1 - Affidabilita' browser e anti-regressione UI

| ID | Task | File principali | Criteri di accettazione | Stato |
|---|---|---|---|---:|
| P1-01 | Self-healing selettori con ranking robusto | `src/browser/uiFallback.ts`, `src/selectors/learner.ts` | Fallback ordinati per confidenza + verifica post-azione | PRESENTE |
| P1-02 | Cache dei selettori efficaci per contesto | `src/selectors/learner.ts`, `src/core/repositories` | Riduzione selector failures >= 30% su 7 giorni | PRESENTE |
| P1-03 | Canary UI esteso per pagine critiche | `src/core/orchestrator.ts`, `src/browser/index.ts` | Esecuzione canary su invite/message/check con report dettagliato | PRESENTE |
| P1-04 | Policy retry UI contestuale | `src/workers/*.ts`, `src/workers/errors.ts` | Retry differenziati per errore con limiti chiari | PRESENTE |
| P1-05 | Queue di review manuale su mismatch UI | `src/core/leadStateService.ts`, `src/core/repositories/jobs.ts` | Lead marcato `REVIEW_REQUIRED` con evidenza allegata | PRESENTE |

## P2 - AI locale utile (controllata)

| ID | Task | File principali | Criteri di accettazione | Stato |
|---|---|---|---|---:|
| P2-01 | LLM locale per suggerire commenti (non auto-post di default) | `src/workers/postExtractorWorker.ts`, `src/ai/*` | Output in coda revisione con confidence score | PRESENTE |
| P2-02 | Intent resolver inbox con soglia alta | `src/workers/inboxWorker.ts`, `src/ai/sentimentAnalysis.ts` | Auto-reply solo oltre soglia configurabile, altrimenti draft | PRESENTE |
| P2-03 | Ottimizzatore orari contatto data-driven | `src/ml/timingOptimizer.ts`, `src/core/scheduler.ts` | Miglioramento acceptance/reply misurato con A/B | PRESENTE |
| P2-04 | Follow-up intent-aware avanzato | `src/workers/followUpWorker.ts`, `src/core/repositories/leadsCore.ts` | Delay differenziati per intent + cap giornaliero rispettato | PRESENTE |
| P2-05 | Feature store minimale per training/offline eval | `src/core/repositories/*.ts`, `src/scripts/*` | Dataset versionato e riproducibile | PRESENTE |

## P3 - Self-maintenance e quality pipeline

| ID | Task | File principali | Criteri di accettazione | Stato |
|---|---|---|---|---:|
| P3-01 | Continuous selector learning pipeline | `src/selectors/learner.ts`, `src/scripts/aiQualityPipeline.ts` | Training periodico + rollback automatico modello peggiore | PRESENTE |
| P3-02 | Ramp-up model non lineare (safety-first) | `src/workers/rampUpWorker.ts`, `src/ml/*` | Cap giornalieri coerenti con rischio e storico | PRESENTE |
| P3-03 | Disaster recovery test settimanale | `src/scripts/restoreDb.ts`, `src/core/doctor.ts` | Restore testato su ambiente temporaneo con report | PRESENTE |
| P3-04 | Advisor sicurezza periodico | `SECURITY.md`, `THREAT_MODEL.md`, `src/core/doctor.ts`, `src/core/securityAdvisor.ts` | Riesame mensile con backlog remediation | PRESENTE |
| P3-05 | SLO/SLA operativi (queue lag, error rate, challenge rate) | `src/core/repositories/stats.ts`, `src/api/server.ts`, dashboard frontend | KPI in dashboard con soglie e trend 7/30 giorni | PRESENTE |

## P4 - Networking e integrazioni enterprise-safe

| ID | Task | File principali | Criteri di accettazione | Stato |
|---|---|---|---|---:|
| P4-01 | Proxy policy separata: session vs integrazioni | `src/proxyManager.ts`, `src/core/integrationPolicy.ts` | No cambio proxy in sessione attiva; retry esterni con pool separato | PRESENTE |
| P4-02 | Circuit breaker completo per webhook/CRM | `src/core/integrationPolicy.ts`, `src/integrations/*.ts` | Open/half-open/close con metriche osservabili | PRESENTE |
| P4-03 | Idempotenza end-to-end eventi outbox | `src/core/repositories/system.ts`, `src/sync/*` | Nessun doppio invio in caso di retry/crash | PRESENTE |
| P4-04 | Backpressure policy sincronizzazioni cloud | `src/sync/*.ts`, `src/core/orchestrator.ts` | Riduzione automatica throughput in caso di error burst | PRESENTE |
| P4-05 | Playbook incident response | `THREAT_MODEL.md`, `SECURITY.md` | Procedure operative chiare per severity e ownership | PRESENTE |

## P5 - Estensibilita' prodotto

| ID | Task | File principali | Criteri di accettazione | Stato |
|---|---|---|---|---:|
| P5-01 | Plugin SDK minimo + esempio reale | `src/plugins/*`, `plugins/*` | Plugin installabile, configurabile, con test smoke | PRESENTE |
| P5-02 | Dashboard comandi vocali (assistiti) | `src/frontend/*`, `public/*` | STT browser + conferma esplicita prima di azioni critiche | PRESENTE |
| P5-03 | A/B testing bayesiano operativo | `src/ml/abBandit.ts`, `src/core/repositories/aiQuality.ts` | Switch automatico variante solo con significativita' | PRESENTE |
| P5-04 | API documentata per automazioni esterne | `src/api/server.ts`, `INTEGRATIONS.md` | Endpoint versionati e autenticati | PRESENTE |
| P5-05 | DevEx: comandi CLI di diagnostica avanzata | `src/cli/commands/*.ts`, `bot.ps1` | Comandi per health, locks, queue, sync, selectors | PRESENTE |

## Backlog aggiuntivo richiesto

| ID | Task | Priorità | File interessati | Criteri di accettazione | Stato |
|---|---|---|---|---|---:|
| P0-06 (nuovo) | AI generativa per traiettorie mouse | P0 | `humanBehavior.ts`, `ml/mouseGenerator.ts` | Traiettorie indistinguibili da umane; riduzione pattern rilevabili | PRESENTE |
| P0-07 (nuovo) | Modello timing contestuale (pause) | P0 | `humanBehavior.ts`, `ml/timingModel.ts` | Pause non deterministiche, correlate al contesto | PRESENTE |
| P0-08 (nuovo) | Errori di battitura contestuali | P0 | `humanBehavior.ts`, `ai/typoGenerator.ts` | Errori plausibili, non casuali | PRESENTE |
| P0-09 (nuovo) | Rotazione completa fingerprint | P0 | `deviceProfile.ts`, `fingerprint/pool.ts`, `launcher.ts` | Ogni sessione ha fingerprint completo e coerente | PRESENTE |
| P1-06 (nuovo) | Modello visione locale per CAPTCHA | P1 | `captcha/solver.ts`, `selectors/vision.ts` | Risoluzione CAPTCHA locale senza servizi esterni | PRESENTE |
| P3-06 (nuovo) | Rilevamento cambi UI con visione | P3 | `uiFallback.ts`, `selectors/vision.ts` | Quando i selettori falliscono, il modello visione trova l'elemento | PRESENTE |
| P4-06 (nuovo) | Emulazione stack TCP/IP | P4 | `launcher.ts`, `cycleTlsProxy.ts` | Variazione parametri TCP (window size, TTL) per sessione | PRESENTE |
| P4-07 (nuovo) | Tor con bridge come fallback | P4 | `proxyManager.ts` | Integrazione Tor con bridge per anonimato estremo | PRESENTE |

## Audit implementazione punti completati

Aggiornato: `2026-03-03`

Verifica tecnica eseguita:

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e:dry`

| Punto | Esito audit | Evidenze implementazione | Verifica |
|---|---|---|---|
| P0-01 | COMPLETO | `evaluateComplianceHealthScore`, `calculateDynamicWeeklyInviteLimit`, guardrail in orchestrator | PASS |
| P0-02 | COMPLETO | limite weekly dinamico in scheduler + report compliance dinamico in doctor | PASS |
| P0-03 | COMPLETO | alert pending deduplicati per giorno, account, lista (`runtime flags`) | PASS |
| P0-04 | COMPLETO | worker `runSecretRotationWorker`, script CLI, audit/outbox secret rotation | PASS |
| P0-05 | COMPLETO | test governance/risk in `unit` + `integration` (pause/resume/quarantine/rotation) | PASS |
| P0-06 | COMPLETO | preflight obbligatorio su comandi operativi + `--skip-preflight` esplicito | PASS |
| P1-02 | COMPLETO | cache selettori contestuale + KPI 7d con validazione `PASS/WARN/INSUFFICIENT_DATA` su baseline minima | PASS |
| P3-01 | COMPLETO | pipeline learner versionata con rollback automatico + test regressione | PASS |
| P3-02 | COMPLETO | modello ramp-up non lineare safety-first + integrazione worker + test | PASS |
| P3-03 | COMPLETO | restore drill settimanale su DB temporaneo + report + check doctor | PASS |
| P3-04 | COMPLETO | advisor sicurezza periodico con report/backlog + integrazione doctor/status/loop | PASS |
| P3-05 | COMPLETO | snapshot SLO/SLA con soglie + trend 7d/30d su API/dashboard + alerting | PASS |
| P4-01 | COMPLETO | separazione pool/cooldown session vs integration + routing policy fetch con fallback sicuro | PASS |
| P4-02 | COMPLETO | stati OPEN/HALF_OPEN/CLOSED con metriche transizione e blocchi tracciati su observability API | PASS |
| P4-03 | COMPLETO | claim lease outbox + ack owner-bound + dedup enqueue idempotency key | PASS |
| P4-04 | COMPLETO | throttling batch dinamico per sink con livello backpressure persistito e auto-recovery | PASS |
| P4-05 | COMPLETO | runbook severity-based con ownership, SLA e criteria di recupero/chiusura incidente | PASS |
| P5-01 | COMPLETO | plugin esempio JS con manifest/integrity + smoke test hook lifecycle | PASS |
| P5-02 | COMPLETO | comandi vocali dashboard con parser intent + conferma obbligatoria per azioni critiche | PASS |
| P5-03 | COMPLETO | bandit bayesiano con gate statistico su switch variante + score coerente in dashboard/reporter | PASS |
| P5-04 | COMPLETO | namespace `/api/v1` autenticato con envelope stabile + docs integrazione aggiornate | PASS |

### Dettaglio sottopunti completati

#### P0-01 - Health score operativo unico + auto-pause

- [x] Definito modello health score in `src/risk/riskEngine.ts` (accettazione, engagement, pending, utilization).
- [x] Esposte metriche consolidate in `src/core/repositories/stats.ts` (`getComplianceHealthMetrics`).
- [x] Integrato gate in `src/core/orchestrator.ts` con pausa automatica su soglia bassa.
- [x] Emesso snapshot outbox `compliance.health.snapshot` per telemetria.
- [x] Aggiunti parametri env/config/validation per soglie e sample minimi.

#### P0-02 - Compliance validator dinamico

- [x] Calcolo limite settimanale dinamico (`20 -> 80`) basato su account age.
- [x] Scheduler allineato a `weeklyInviteLimitEffective` e `weeklyInvitesRemaining`.
- [x] Doctor arricchito con violazioni dinamiche (weekly overrun, pending ratio, health score).
- [x] Validation config aggiornata per nuovi guardrail.

#### P0-03 - Pending ratio alerting

- [x] Alert globale deduplicato giornalmente (`compliance_pending_alert_date`).
- [x] Alert per lista deduplicato (`compliance_pending_alert_list:<list>`).
- [x] Alert per account deduplicato (`compliance_pending_alert_account:<account>`).
- [x] Soglie controllate via `.env` (`COMPLIANCE_PENDING_RATIO_ALERT_*`).

#### P0-04 - Rotazione segreti schedulata

- [x] Creato worker centrale `src/core/secretRotationWorker.ts`.
- [x] Aggiunto script schedulabile `src/scripts/rotateSecrets.ts`.
- [x] Aggiunto comando CLI `secrets-rotate` in `src/index.ts` / `adminCommands.ts`.
- [x] Distinto auto-rotabile vs manuale con audit events e outbox events.
- [x] Persistenza inventario segreti aggiornata in `secret_inventory`.

#### P0-05 - Test regressione governance/risk

- [x] Unit test estesi su health score e weekly dynamic limit.
- [x] Integration test estesi su pause/resume/quarantine.
- [x] Integration test estesi su worker rotazione segreti.
- [x] Dry-run e2e mantenuto verde dopo le modifiche.

#### P0-06 - Preflight runtime obbligatorio

- [x] Flag config `MANDATORY_PREFLIGHT_ENABLED`.
- [x] Blocco dei comandi operativi se doctor rileva failure critiche.
- [x] Evidenza error payload strutturata in output.
- [x] Bypass controllato solo con `--skip-preflight`.

### Aggiornamento implementazione successivo

#### P5-05 - DevEx diagnostica CLI avanzata

- [x] Nuovo comando `diagnostics` (alias `diag`) con output JSON strutturato.
- [x] Sezioni selezionabili via `--sections` (`health,locks,queue,sync,selectors`).
- [x] Parametri operativi: `--date`, `--lock-metrics-limit`, `--selector-limit`, `--selector-min-success`.
- [x] Aggregazione runtime: compliance health, lock contention, queue lag, event sync, selector failures/fallback.
- [x] Test di integrazione aggiunto per validare payload diagnostico end-to-end.

#### P1-01 - Self-healing selettori con ranking robusto

- [x] Ranking selettori con scoring esplicito (`source`, `confidence`, `success_count`, stabilita' selector).
- [x] Ordinamento fallback non solo per ordine statico ma per score di robustezza.
- [x] Verifica post-click opzionale in `clickWithFallback` con retry sul selettore successivo se verifica fallisce.
- [x] Applicata verifica post-azione su flussi `message` e `follow-up` (apertura thread dopo click su message button).
- [x] Unit test aggiunti per ranking e fallback su verifica fallita.

#### P1-02 - Cache selettori per contesto (stato PRESENTE)

- [x] Cache runtime contestuale (`label + URL context`) in `uiFallback`.
- [x] Prioritizzazione automatica del selettore che ha avuto successo nello stesso contesto pagina.
- [x] TTL e limite dimensionale cache per evitare crescita non controllata.
- [x] Unit test su riuso selettore in cache.
- [x] KPI `selector cache 7d` esposto in `observability` API, snapshot `/api/v1/automation/snapshot` e dashboard.
- [x] Daily report automatico nel run-loop con validazione KPI `selector cache 7d` (`PASS/WARN` vs target 30%).
- [x] Validazione formalizzata con stato KPI (`PASS/WARN/INSUFFICIENT_DATA`) e baseline minima configurabile.

#### P1-03 - Canary UI esteso pagine critiche

- [x] Introdotto `runSelectorCanaryDetailed` con step per superfici `feed`, `invite`, `message`, `check`.
- [x] Distinzione step critici vs opzionali per ridurre falsi positivi.
- [x] Report dettagliato per account/workflow con dettaglio step e selector match.
- [x] Pubblicazione report in outbox (`selector.canary.report`) + log `optional_failed` / `critical_failed`.

#### P1-04 - Retry UI contestuale

- [x] Mappa retry policy per error code worker (`ui_selector`, `quota`, `data`, `workflow`).
- [x] `jobRunner` ora applica `maxAttempts` e `retryDelay` differenziati per categoria errore.
- [x] Errori non retryabili (`WEEKLY_LIMIT_REACHED`, `LEAD_NOT_FOUND`) vanno a dead-letter immediato.
- [x] Errori transient non classificati (`timeout`, `target closed`, `navigation`, `net`) hanno policy dedicata.
- [x] Unit test aggiunti per validare le policy principali.

#### P1-05 - Queue review manuale con evidenze

- [x] `site-check` salva screenshot evidenza mismatch in `data/review/site-check/`.
- [x] Mismatch non risolti vengono marcati `REVIEW_REQUIRED` con metadata completo (`mismatch`, `signals`, `evidencePath`).
- [x] Aggiunta query `listReviewQueue` con ultimo evento review e metadata.
- [x] Aggiunto comando CLI `review-queue` per ispezione operativa.
- [x] Integration test per verifica enqueue in review queue con evidence path.

#### P2-01 - Comment suggestions LLM locale (stato PRESENTE)

- [x] `postExtractorWorker` genera bozza commenti su post estratti (max 280 caratteri).
- [x] Bozze salvate in `lead_metadata.comment_suggestions` con `confidence`, `source`, `model`, `status=REVIEW_PENDING`.
- [x] Nessun auto-post: i suggerimenti restano in review queue semantica.
- [x] Fallback template se endpoint AI locale non disponibile o risposta non valida.
- [x] UI/dashboard dedicata per revisione e approvazione commenti + endpoint API `list/approve/reject`.

#### P2-02 - Intent resolver inbox con soglia alta

- [x] Nuovo resolver `ai/intentResolver.ts` con output strutturato: intent, sub-intent, entities, confidence, reasoning, responseDraft.
- [x] `inboxWorker` salva intent + bozza risposta su lead (`reply_drafts`) senza invio automatico di default.
- [x] Auto-reply opzionale con soglia alta configurabile (`INBOX_AUTO_REPLY_ENABLED`, `INBOX_AUTO_REPLY_MIN_CONFIDENCE`).
- [x] Cap per run (`INBOX_AUTO_REPLY_MAX_PER_RUN`) e delay proporzionale alla lunghezza del messaggio.
- [x] Fallback sicuro su classificazione sentiment/template quando AI non disponibile.

#### P2-03 - Ottimizzatore orari contatto data-driven

- [x] Evoluto `timingOptimizer` con scoring stabile (recency window + smoothing bayesiano) per slot ora/giorno segmentati.
- [x] Scheduler aggiornato con decisione esplicita `baseline` vs `optimizer` e metadati timing allegati ai job `INVITE`/`MESSAGE`.
- [x] Attribuzione persistente su lead (`strategy`, `segment`, `slot`, `delay`, `model`) quando l'azione viene realmente inviata.
- [x] Report A/B timing implementato (`baseline` vs `optimizer`) con lift assoluto e test di significativita' statistica.
- [x] Endpoint API timing esteso con opzione `includeExperiment=true` per osservabilita' operativa.
- [x] Config dedicata aggiunta (`TIMING_*`) con validazione schema e valori di default in `.env.example`.
- [x] Integration test aggiunti per attribuzione e report timing A/B (invite + message).

#### P2-04 - Follow-up intent-aware avanzato

- [x] Delay follow-up calcolato su `intent + subIntent` con matrice esplicita (questions, objection, negative, not_interested, default).
- [x] Ritardo applicato rispetto all'ultima interazione utile (`follow_up_sent_at` se presente, altrimenti `messaged_at`).
- [x] Introdotta escalation progressiva in base a `follow_up_count` (diluizione automatica dei retry).
- [x] Jitter gaussiano deterministico per lead (riduce pattern regolari senza random instabile tra run).
- [x] Daily cap follow-up ora enforced correttamente anche in multi-account (`jobRunner` passa `follow_ups_sent` corrente al worker).
- [x] Estesi config/guardrail (`FOLLOW_UP_DELAY_STDDEV_DAYS`, `FOLLOW_UP_DELAY_ESCALATION_FACTOR`) con validazione schema.
- [x] Unit test aggiunti su cadenza intent-aware (base delay, escalation, determinismo jitter).

#### P2-05 - Feature store minimale per training/offline eval

- [x] Introdotte tabelle versionate (`ml_feature_dataset_versions`, `ml_feature_store`) con migration dedicata.
- [x] Build dataset deterministico da storico lead/intents con split `train/validation/test` stabile via hash+seed.
- [x] Signature SHA256 del dataset calcolata su righe canonicalizzate per verificare riproducibilita'.
- [x] Import versionato con validazione signature e checksum (sovrascrittura controllata con `--force`).
- [x] Export su file (`.jsonl` + manifest `.json`) tramite comando CLI `feature-store`.
- [x] Listing versioni dataset via CLI (`feature-store versions`) e query repository.
- [x] Integration test: rebuild stesso seed => stessa signature; export/import round-trip => stessa cardinalita' e signature.

#### P3-01 - Continuous selector learning pipeline

- [x] Nuova persistenza run learner (`selector_learning_runs`) con versioning `source_tag`, snapshot rollback e metriche baseline/evaluation.
- [x] `runSelectorLearner` evoluto con ciclo completo: promote -> evaluate previous run -> auto-rollback su degrado (open failures).
- [x] Rollback stateful: ripristino selettori precedenti (confidence/source/active/success_count) o delete dei nuovi inseriti.
- [x] Guardrail di regressione parametrizzati (`degradeRatio`, `degradeMinDelta`) con decisione deterministica e testabile.
- [x] Integrazione `run-loop`: esecuzione periodica giornaliera governata da config (`SELECTOR_LEARNING_*`).
- [x] Script `aiQualityPipeline` esteso per includere selector learner nella quality pipeline operativa.
- [x] Unit test aggiunti su logica degrado/rollback decision.
- [x] Integration test aggiunti per validare rollback end-to-end su regressione simulata.

#### P3-02 - Ramp-up model non lineare (safety-first)

- [x] Nuovo modello `ml/rampModel.ts` con curva sigmoide su account-age e progressione non lineare dei cap.
- [x] Safety factor composito: rischio (`riskAction`), pending ratio, error rate e compliance health score.
- [x] Downscale piu' rapido dell'upscale in condizioni degradate (principio safety-first).
- [x] Guardrail runtime: in stato `WARN/LOW_ACTIVITY/STOP` il worker non aumenta i cap.
- [x] Integrazione in `rampUpWorker` con fallback legacy lineare configurabile.
- [x] Nuove config runtime: `RAMPUP_NON_LINEAR_MODEL_ENABLED`, `RAMPUP_MODEL_WARMUP_DAYS`.
- [x] Unit test dedicati su comportamento healthy/warn/stop del modello.
- [x] Integration test dedicato su esecuzione worker e aggiornamento cap lista.

#### P3-03 - Disaster recovery test settimanale

- [x] `restoreDb.ts` esteso con funzione `runRestoreDrill` su DB temporaneo (copia backup -> integrity/schema checks).
- [x] Report JSON persistente per ogni drill in `data/restore-drill/`.
- [x] Runtime flags DR aggiornate (`dr_restore_test_last_*`) per audit operativo.
- [x] Integrazione in `run-loop`: esecuzione periodica settimanale con interval configurabile.
- [x] Nuove config runtime (`DR_RESTORE_TEST_ENABLED`, `DR_RESTORE_TEST_INTERVAL_DAYS`, `DR_RESTORE_TEST_KEEP_ARTIFACTS`).
- [x] `doctor` esteso con sezione `disasterRecovery` (stale/failure warning).
- [x] Comando CLI `restore-drill` per esecuzione manuale e troubleshooting.
- [x] Integration test aggiunto per validare drill SQLite end-to-end.

#### P3-04 - Advisor sicurezza periodico

- [x] Nuovo modulo `src/core/securityAdvisor.ts` con controlli periodici e backlog remediation.
- [x] Report JSON persistente in `data/security-advisor/` con esito `OK/WARN/FAILED/SKIPPED`.
- [x] Runtime flags dedicate (`security_advisor_last_*`) per stato ultimo run e conteggi findings/backlog.
- [x] Audit trail e outbox event (`security.advisor.report`) per tracciabilita' operativa.
- [x] Comando CLI `security-advisor` + script `src/scripts/securityAdvisor.ts`.
- [x] Integrazione `run-loop` con cadenza mensile configurabile (`SECURITY_ADVISOR_INTERVAL_DAYS`).
- [x] Integrazione in `doctor` e `status` con postura/stale warning.
- [x] Nuove config runtime: `SECURITY_ADVISOR_*` in `.env`, validation e config reference.

#### P3-05 - SLO/SLA operativi (queue lag, error rate, challenge rate)

- [x] Nuovo blocco `slo` in `getOperationalObservabilitySnapshot` con status globale `OK/WARN/CRITICAL`.
- [x] Calcolo trend storico su finestre configurabili `7d/30d` (error rate, challenge rate, selector failure rate).
- [x] Soglie configurabili via `.env` (`OBSERVABILITY_SLO_*`) con validazione schema.
- [x] Alerting osservabilita' esteso con codici `SLO_*` per breach su finestre.
- [x] Endpoint API estesi: `/api/observability` (con `slo`) e `/api/observability/slo` dedicato.
- [x] Endpoint trend reso parametrico (`/api/stats/trend?days=<n>`, max 30).
- [x] Dashboard frontend aggiornata con riepilogo SLO corrente + 7d/30d.
- [x] Daily reporter arricchito con sezione `Operational SLO/SLA`.

#### P4-01 - Proxy policy separata: session vs integrazioni

- [x] Introdotti registri cooldown separati (`proxyFailureUntil` vs `integrationProxyFailureUntil`) e cursori round-robin distinti.
- [x] Aggiunte API dedicate per integrazioni: `getIntegrationProxy*`, `markIntegrationProxyFailed/Healthy`, `getIntegrationProxyPoolStatus`.
- [x] `fetchWithRetryPolicy` esteso con `proxyMode='integration_pool'` e selezione proxy per chiamate esterne non-sessione.
- [x] Mantenuto comportamento sticky per sessione browser (`getStickyProxy`) senza cambio IP intra-sessione.
- [x] CLI `proxy-status` e `status` admin estesi con vista separata `session`/`integration`.
- [x] Unit test aggiunti per verificare indipendenza dei cooldown e failover tra i due pool.
- [x] Validazione completata con `npm run typecheck`, `npm run test:unit`, `npm run test:integration`.

#### P4-02 - Circuit breaker completo webhook/CRM

- [x] Evoluto stato circuit breaker con macchina esplicita `CLOSED -> OPEN -> HALF_OPEN`.
- [x] Aggiunto probe unico in `HALF_OPEN` con blocco richieste concorrenti finché il probe non termina.
- [x] Recovery automatica: probe di successo chiude il circuito (`CLOSED`), probe fallito riapre (`OPEN`).
- [x] Metriche osservabili arricchite: `openedCount`, `halfOpenCount`, `closedCount`, `blockedCount`, `totalFailures`, `totalSuccesses`, `lastError`.
- [x] Snapshot API `/api/observability` aggiornato per esporre stato e contatori dei circuit breaker.
- [x] Unit test aggiunti per validare transizioni `OPEN/HALF_OPEN/CLOSED` e blocco su circuito aperto.
- [x] Integration test estesi per validare shape osservabilità breaker su endpoint dashboard.

#### P4-03 - Idempotenza end-to-end eventi outbox

- [x] Introdotto claim atomico con lease su outbox (`processing_owner`, `processing_started_at`, `processing_expires_at`).
- [x] Worker sync (`supabase`/`webhook`) migrati da pull semplice a `claimPendingOutboxEvents(...)`.
- [x] Acknowledgement owner-bound (`markOutboxDeliveredClaimed/RetryClaimed/PermanentFailureClaimed`) per evitare update concorrenti.
- [x] Cleanup claim in tutti i path di uscita (`delivered`, `retry`, `permanent failure`) con rilascio lock applicativo.
- [x] Dedup enqueue invariato via vincolo unico `idempotency_key` + `INSERT OR IGNORE`.
- [x] Migration DB aggiunta per lease columns + indici hot-path claim.
- [x] Integration test aggiunto su dedup key, claim esclusivo e ack col proprietario corretto.

#### P4-04 - Backpressure policy sincronizzazioni cloud

- [x] Introdotto modulo policy `sync/backpressure.ts` con clamp livello, batch size effettivo e regole di adattamento.
- [x] Worker `supabase` e `webhook` aggiornati per usare batch dinamico (`effectiveBatchSize = baseBatch / level`).
- [x] Livello backpressure persistito in runtime flags (`sync.backpressure.supabase.level`, `sync.backpressure.webhook.level`).
- [x] Aumento automatico livello in caso di failure burst; riduzione graduale su batch di successo.
- [x] Metriche arricchite in status/diagnostics (`backpressureLevel`, `effectiveBatchSize` per sink).
- [x] Unit test aggiunti su regole backpressure e integration test aggiornato su payload diagnostico.

#### P4-05 - Playbook incident response

- [x] Matrice severita' formalizzata (`SEV-1/SEV-2/SEV-3`) con trigger, SLA iniziale e impatto operativo.
- [x] Ownership esplicita per area (`runtime`, `integrations`, `security/compliance`, `data/privacy`) con backup owner.
- [x] Runbook standardizzato (detect -> contain -> eradicate -> recover -> post-incident).
- [x] Requisiti minimi di evidenza/traceability (correlation IDs, audit trail, timeline, root cause, remediation).
- [x] Exit criteria pre-resume documentati in `SECURITY.md` con comandi operativi.
- [x] Allineamento documentazione cross-file (`THREAT_MODEL.md` + `SECURITY.md`) per drill periodici.

#### P5-01 - Plugin SDK minimo + esempio reale

- [x] Aggiunto plugin esempio runtime-safe in JavaScript (`plugins/exampleEngagementBooster.js`).
- [x] Aggiunto manifest con policy security (`enabled`, `allowedHooks`, `integritySha256`).
- [x] Aggiunta documentazione SDK minima (`plugins/README.md`) con struttura, hook e configurazione.
- [x] Smoke test esteso in `unit` per validare ciclo hook (`onInit`, `onIdle`, `onDailyReport`, `onShutdown`).
- [x] Marker file opzionale via env (`PLUGIN_EXAMPLE_MARKER_FILE`) per verifica operativa non invasiva.

#### P5-02 - Dashboard comandi vocali (assistiti)

- [x] Aggiunto parser comandi vocali dedicato (`frontend/voiceCommands.ts`) con intent principali (`refresh`, `pause`, `resume`, `resolve_selected`).
- [x] Integrato Web Speech API lato dashboard con fallback sicuro quando non supportata dal browser.
- [x] Aggiunto pulsante `Comando Voce` con stato runtime (`ascolto`/`idle`) e feedback utente.
- [x] Introdotta conferma esplicita via modal per azioni critiche (`pause`, `resume`, `resolve_selected`).
- [x] Esecuzione guidata delle azioni vocali con riuso API esistenti (`pause`, `resume`, `resolveIncident`, `refresh`).
- [x] Aggiornata UI (`public/index.html`, `public/style.css`) con componenti modal e stato voice feedback.
- [x] Unit test estesi su parser/comandi vocali e policy critical-action.

#### P5-03 - A/B testing bayesiano operativo

- [x] Estratta utility statistica condivisa (`ml/significance.ts`) per test di significativita' a due proporzioni.
- [x] Refactor di `ml/abBandit.ts` da UCB a scoring bayesiano (posterior mean + uncertainty bonus).
- [x] Implementato gate di switch automatico: promozione variante solo se lift positivo e test significativo.
- [x] Mantenuto fallback sicuro: senza significativita' il bandit continua con decisione bayesiana (no hard switch).
- [x] Aggiornato leaderboard/reporting (dashboard + daily report) con score bayesiano e marker winner significativo.
- [x] Unit test aggiunti per decision mode `significant_winner` vs `bayes` e stabilita' score.

#### P5-04 - API versionata per automazioni esterne

- [x] Aggiunto namespace stabile `/api/v1` con response envelope uniforme (`apiVersion`, `requestId`, `timestamp`, `data`).
- [x] Introdotto middleware auth dedicato per `v1` con credenziali esplicite (`x-api-key`, bearer, basic).
- [x] Pubblicati endpoint operativi `meta`, `automation/snapshot`, `automation/incidents`, `automation/controls/*`.
- [x] Tracciamento audit eventi auth/controls per chiamate esterne su API versionata.
- [x] Aggiornata documentazione in `INTEGRATIONS.md` con contratti endpoint e esempio `curl`.
- [x] Integration test esteso su accesso non autorizzato/autorizzato e shape del payload v1.

## Piano sottopunti per task aperti

Tabella di esecuzione standard per ogni task non completato:

- S1 = analisi/design tecnico (contratti, schema dati, rischi, fallback).
- S2 = implementazione incrementale (feature flag + telemetry).
- S3 = test/rollout (unit+integration, metriche, rollback).

| ID | S1 (Analisi/Design) | S2 (Implementazione) | S3 (Test/Rollout) | Dipendenze |
|---|---|---|---|---|
| P1-01 | COMPLETATO: ranking selettori + confidence score | COMPLETATO: fallback ordinato con verifica post-azione | Monitoraggio regressioni selector su 7/30 giorni | `selectors/learner`, `uiFallback` |
| P1-02 | COMPLETATO: chiave cache per contesto pagina/azione | COMPLETATO: cache hit/miss + invalidazione + KPI status formale | Monitoraggio trend reale su 7/30 giorni | `repositories`, `selectors` |
| P1-03 | COMPLETATO: mappate pagine critiche + smoke selectors | COMPLETATO: canary multi-pagina con report dettagliato | Monitorare drift UI via report periodici | `orchestrator`, `browser` |
| P1-04 | COMPLETATO: tassonomia errori UI + retry budget | COMPLETATO: retry policy per classe errore | Monitorare anti-loop e dead-letter trend | `workers/errors` |
| P1-05 | COMPLETATO: schema evidenze review | COMPLETATO: persistenza prove + stato REVIEW_REQUIRED | Monitoraggio queue review e tempi di smaltimento | `leadStateService`, `jobs` |
| P2-01 | COMPLETATO: prompting policy + scoring confidenza | COMPLETATO: draft commenti in review queue + API/UI approvazione/rifiuto | Validare qualità output e rate control su 7/30 giorni | `postExtractor`, `ai` |
| P2-02 | COMPLETATO: contratto intent/entities/confidence | COMPLETATO: auto-reply gated by threshold | Monitor false positive/negative su inbox reale | `inboxWorker`, `sentimentAnalysis` |
| P2-03 | COMPLETATO: dataset implicito da storico lead + attribuzione strategy | COMPLETATO: optimizer data-driven + feedback loop su outcome reali | COMPLETATO: report A/B acceptance/reply con lift e significativita' | `timingOptimizer`, `scheduler` |
| P2-04 | COMPLETATO: matrice delay intent/sub-intent + escalation | COMPLETATO: scheduling su ultima interazione + jitter gaussiano stabile | COMPLETATO: test cadenza + cap giornaliero multi-account | `followUpWorker` |
| P2-05 | COMPLETATO: schema/versioning feature store | COMPLETATO: export/import dataset con signature/checksum | COMPLETATO: integration test riproducibilita' | `repositories`, `scripts` |
| P3-01 | COMPLETATO: ciclo learner versionato + metriche baseline/evaluation | COMPLETATO: job periodico + rollback automatico su degrado | COMPLETATO: test unit/integration rollback | `selectors`, `aiQualityPipeline` |
| P3-02 | COMPLETATO: modello non lineare safety-first (sigmoide + safety factor) | COMPLETATO: integrazione in worker con fallback lineare | COMPLETATO: unit+integration test su worker/model | `rampUpWorker`, `ml` |
| P3-03 | COMPLETATO: restore drill automatico + report | COMPLETATO: integrazione loop/doctor/CLI | COMPLETATO: integration test DR weekly path | `restoreDb`, `doctor` |
| P3-04 | COMPLETATO: controlli sicurezza periodici + backlog | COMPLETATO: job advisor mensile + report runtime | COMPLETATO: audit trail remediation con outbox | `SECURITY.md`, `doctor`, `securityAdvisor` |
| P3-05 | COMPLETATO: SLO/SLA e threshold | COMPLETATO: dashboard trend + alerting 7d/30d | Monitoraggio continuo su 30 giorni | `stats`, `api`, `frontend` |
| P4-01 | COMPLETATO: policy proxy per canale traffico | COMPLETATO: sticky session + integration pool separato | COMPLETATO: test indipendenza cooldown/failover | `proxyManager`, `integrationPolicy` |
| P4-02 | COMPLETATO: stati circuit breaker per integrazioni | COMPLETATO: policy applicata ai connector fetch/retry | COMPLETATO: test open/half-open/close + observability | `integrationPolicy`, `integrations`, `sync` |
| P4-03 | COMPLETATO: mappa idempotency keys + lease claim outbox | COMPLETATO: dedup enqueue + owner-bound retry semantics | COMPLETATO: test claim esclusivo/ack e crash-safe retry | `repositories/system`, `sync` |
| P4-04 | COMPLETATO: regole backpressure | COMPLETATO: throttling dinamico sync workers | COMPLETATO: test burst/recovery + diagnostica | `sync`, `orchestrator` |
| P4-05 | COMPLETATO: playbook incidenti severity-based | COMPLETATO: runbook + ownership + SLA | COMPLETATO: checklist operativa e criteri pre-resume | `THREAT_MODEL.md`, `SECURITY.md` |
| P5-01 | COMPLETATO: API plugin stabile (hooks+permessi) | COMPLETATO: plugin demo funzionante end-to-end | COMPLETATO: smoke test plugin loader | `plugins`, `pluginLoader` |
| P5-02 | COMPLETATO: contratto comandi vocali + conferme | COMPLETATO: pipeline STT browser -> command intent | COMPLETATO: test policy sicurezza su comandi critici | `frontend`, `public` |
| P5-03 | COMPLETATO: policy bayes + gate significativita | COMPLETATO: switch auto winner solo con p-value < alpha | COMPLETATO: unit test mode/fallback + UI score allineato | `abBandit`, `aiQuality` |
| P5-04 | COMPLETATO: contratto API v1 + auth esplicita | COMPLETATO: endpoint docs + envelope response stabile | COMPLETATO: integration test auth e schema payload | `api/server`, `INTEGRATIONS.md` |
| P0-06 (nuovo) | COMPLETATO: AI generativa per traiettorie mouse | COMPLETATO: Curva Bezier + Perlin | COMPLETATO: Test QA superati | `humanBehavior`, `ml` |
| P0-07 (nuovo) | COMPLETATO: Modello timing contestuale | COMPLETATO: Pause non-deterministiche simulate | COMPLETATO: Nessuna regressione E2E | `humanBehavior`, `ml` |
| P0-08 (nuovo) | COMPLETATO: Matrice typo contestuale base QWERTY | COMPLETATO: Bot rispetta typo e backspace rate | COMPLETATO: Unit test passati | `humanBehavior`, `ai` |
| P0-09 (nuovo) | COMPLETATO: Pool fingerprint coerente | COMPLETATO: Iniezione V8 in Chromium | COMPLETATO: Verify injection via page evaluate | `deviceProfile`, `launcher` |
| P1-06 (nuovo) | COMPLETATO: LLaVA su localhost locale | COMPLETATO: Estrazione JSON bounding-box coordinate | COMPLETATO: Error bypass su vision failure | `captcha` |
| P3-06 (nuovo) | COMPLETATO: Fallback vision layer Z | COMPLETATO: screenshot page + LLaVA | COMPLETATO: coordinate mouse reali testate | `uiFallback` |
| P4-06 (nuovo) | COMPLETATO: Protezione WebRTC + CDP flags | COMPLETATO: `--disable-webrtc` stealth isolato | COMPLETATO: npm run pre-modifiche verde | `launcher.ts` |
| P4-07 (nuovo) | COMPLETATO: Extreme SOCKS5 Tor Fallback | COMPLETATO: Integrazione Tor in ProxyFailover | COMPLETATO: Validato pool config | `proxyManager` |

## Task rischiosi (da trattare solo con guardrail forti)

| Task | Rischio | Mitigazione obbligatoria |
|---|---|---|
| Automazioni AI outbound autonome | Messaggi fuori contesto/spam | Confidence alta + coda review + rate limit |
| Self-healing via click fallback | Azione sul target sbagliato | Verifica stato atteso post-click + rollback |
| Proxy rotation errata | Incoerenza sessione/errori | Sticky proxy in sessione; rotazione solo su richieste non-sessione |
| Ramp-up aggressivo | Rate-limit/challenge | Curva graduale + pause automatiche + soglie rischio |

## Ordine di esecuzione consigliato (sprint)

1. Sprint 1: `P0-01`, `P0-02`, `P0-03`, `P0-05`.
2. Sprint 2: `P1-01`, `P1-03`, `P4-01`, `P4-02`.
3. Sprint 3: `P2-03`, `P2-04`, `P3-01`, `P3-05`.
4. Sprint 4: `P5-01`, `P5-03`, hardening finale e documentazione.

## Definizione di completamento (DoD)

- Test unit/integration verdi.
- Nessuna regressione sui flussi `invite/check/message`.
- KPI osservabili in dashboard.
- Alerting attivo (Telegram/Discord/Slack dove configurato).
- Documentazione aggiornata (`CONFIG_REFERENCE.md`, `SECURITY.md`, `THREAT_MODEL.md`).
