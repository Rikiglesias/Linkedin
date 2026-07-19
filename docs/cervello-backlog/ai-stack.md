# /goal ai-stack — strato AI del bot: modello ottimale per ogni punto + cervello connesso ai segnali live

> Binding GOAL_TASK_BINDING. Creato 2026-06-11. Visione utente (verbatim):
> «usiamo un AI potente anche per l'orchestratore, per il cervello. Per qualsiasi cosa il bot faccia,
> deve essere collegato e ricevere segnali in live e consegnarli di nuovo al bot per decision-making.
> E dimmi dove usiamo l'AI e quale conviene — qualità-prezzo è importante.»
>
> Codice VIVO anti-ban (src/ai/**, src/salesnav/**, src/risk/**) → edit SOLO a goal attivo, INLINE,
> antiban-review + 5 domande pre-merge per ogni chunk; ogni chunk L1-verde (zero-Q).
> NOTA: i dettagli modello-per-call-site (Fase 2) vengono POPOLATI dalla sintesi del workflow
> wilo97wly (mappa AI + pricing) — il file sarà arricchito al primo turno della fase.
>
> 🛑 **2026-06-13 — Fable 5 RITIRATO da Anthropic il 2026-06-12** (direttiva di sicurezza USA, sospeso a
> tempo indefinito). Ovunque sotto Fable 5 compaia come opzione/raccomandazione, leggere **Opus 4.8**
> (`claude-opus-4-8`) = flagship GA più capace disponibile. Migrazione computer-use→Fable definitivamente
> annullata (binding `vision-fable.md` archiviato + F1 già superseded).

## End-state (misurabile)

1. **Vision/computer-use migrato a Fable 5**: `src/salesnav/computerUse.ts` su protocollo Anthropic
   (claude-fable-5), parità funzionale col flusso bulk-save SalesNav.
2. **Modello ottimale per OGNI call-site AI** (matrice qualità-prezzo applicata): nessun model id
   hardcoded sparso; scelta centralizzata (providerRegistry/router) e provider-agnostica.
3. **Cervello connesso ai segnali live**: guardian (strategico) + aiDecisionEngine (tattico) ricevono
   i segnali live rilevanti (risk, incident, pending ratio, account health, canary, challenge) e le
   decisioni TORNANO al bot e ne cambiano il comportamento (verificato, non solo log).
4. **Dipendenze AI sane**: circuit breaker `openai.chat` — root cause capita e risolta o migrata.
5. Gate: `npm run conta-problemi` exit 0 + antiban-review SICURO su ogni chunk + worklog/binding aggiornati.

## Fasi / task (DONE + VERIFY per ognuno)

- [x] **F1 — Vision → Fable 5** — **SUPERSEDED 2026-06-11** dalla decisione zero-PII (sezione DECISIONE
  UTENTE risolta): vision/computer-use restano LOCALI, gli screenshot non escono dalla macchina; la migrazione
  cloud (Fable o altro) è OPZIONE FUTURA spenta, riattivabile solo con DPA+zero-retention+informativa.
  Il residuo utile (model id centralizzati e config-driven, gate cloud esplicito) è stato assorbito ed
  ESEGUITO in F2 (commit `2c81742`). `~/todos/vision-fable.md` non più applicabile as-is.

- [x] **F0 — PREREQUISITO: provider Anthropic + cablare il routing** — **DONE 2026-06-11** (commit `7655398` chunk A
  client+config, `d66e1cf` chunk B registry+guard-PII, `3675efb` chunk C cablaggio 13 call-site, chunk D+E test catena
  fallback + preflight Anthropic). VERIFY: conta-problemi exit 0 ad ogni chunk; suite 169 file/1658+ test; guard zero-PII
  testata nel dispatch reale; `auto` ≡ comportamento storico (mai anthropic in F0); antiban-review SICURO.
  **Residuo leva utente (E2E live)**: serve nel `.env` → `ANTHROPIC_API_KEY=<key>` + `AI_PROVIDER=anthropic` +
  `AI_ALLOW_REMOTE_ENDPOINT=true` + `AI_GUARDIAN_ENABLED=true` (o `AI_PERSONALIZATION_ENABLED=true` per decoy), poi
  `bot.ps1 preflight-env` (check "Anthropic: OK") e un run → log `ai_text.cloud_dispatch {provider: anthropic}`.
  NOTA ARCH: ramo H28 `openai_circuit_open_ollama_fallback` con OLLAMA_FALLBACK_URL = risoluzione-only (baseUrl
  hardcoded + circuitKey condiviso in openaiClient) → fix in F4. semanticChecker resta su openaiClient (embeddings, by-design).

- [x] **F0.5 — Pseudonimizzazione del cervello** — **DONE 2026-06-11** (commit `e386d8b` leadPseudonymizer+property
  test, `02dfe21` buildDecisionPrompt anonimo+guard cloud_pii_suspect, `2652ed9` flip decision_engine→no-PII+GDPR art.30).
  Il decision engine è ora CLOUD-ELIGIBLE: prompt = solo enum chiusi/boolean/numeri (segment/industry/seniority/region
  coarse/score/degree), chat distillata in segnali (count/lastFrom/replied), MAI nome/email/URL/azienda/testo libero.
  Prova meccanica: test sentinella sui 5 decision point + property test pseudonymizer. Worker INTATTI.
  VERIFY: conta-problemi exit 0 ×3; 171 file / 1690 test; antiban SICURO. Nota: con `AI_PROVIDER=anthropic` il cervello
  va su Claude (anthropic_selected); in auto con OpenAI key remota andrebbe su OpenAI (dichiarato: guard sul dato, non sul vendor).
  Residui rimandati con causa: wire `inbox_reply` (punto orfano, nessun caller prod) → F3; accuracy post-anonimizzazione
  monitorata da decisionFeedback → eventuale tuning in F3.
  - Stato reale: ZERO Anthropic in src/ (grep 0 match). Tutto passa da `openaiClient.requestOpenAIText`
    (OpenAI chat/completions-shaped); default `OPENAI_BASE_URL=localhost:11434` + `AI_MODEL=llama3.1:8b`
    → out-of-the-box gira su OLLAMA LOCALE. `providerRegistry.resolveAiProvider` (openai/ollama/template)
    esiste ma NON è cablato (0 consumer prod) → fallback H28 morto.
  - DONE: aggiungere provider Anthropic (`@anthropic-ai/sdk`, messages API) dietro un'astrazione provider
    e CABLARE providerRegistry nel path reale (brain+guardian+13 personalizer chiamano direttamente
    requestOpenAIText, bypassano il registry); circuit breaker già reale in integrationPolicy.
  - VERIFY: conta-problemi exit 0; un call-site critico instradato a Claude end-to-end + fallback testato.

- [x] **F2 — Matrice modello per call-site** — **DONE 2026-06-11** (commit `c5f860f` tier per-purpose
  brain/light + model nel dispatch reale, `2c81742` vision/CU zero-PII default + model id centralizzati,
  chunk C generatore config-docs riparato+marker-aware + CONFIG_REFERENCE rigenerato).
  VERIFY eseguito: grep model id hardcoded in prod fuori da config/domains.ts = 0; conta-problemi exit 0
  ad ogni chunk (finale 172 file / 1698 test); madge 0 cicli; antiban SICURO; costo/1000-azioni nel worklog
  (light −80%, screenshot cloud default $0). Tier: brain=ANTHROPIC_MODEL (Opus 4.8 default; opzione Fable via env rimossa — Fable 5 ritirato 2026-06-12),
  light=ANTHROPIC_MODEL_LIGHT (Haiku default) su decoy_terms/post_content; vision/CU locali salvo
  VISION_ALLOW_CLOUD+AI_ALLOW_REMOTE_ENDPOINT (prima bastava OPENAI_API_KEY: PII visiva usciva — chiuso).
  (Dettaglio matrice originale qui sotto, conservato come riferimento storico; righe Haiku-PII/Gemini/Sonnet
  già SUPERSEDED dalla sezione zero-PII.)
  - Cervello/decisione anti-ban (aiDecide, guardian, aiAdvisor) → **Opus 4.8** default ($5/$25), top tier GA
    disponibile (Fable 5 ritirato 2026-06-12). Volume basso, qualità critica → mai sotto Opus.
  - Computer-use (computerUse.ts, oggi gpt-5.4 hardcoded) → **Opus 4.8** (Fable 5 ritirato 2026-06-12; CU resta
    LOCALE per zero-PII, F1 superseded); raro/fallback.
  - Vision alta frequenza (navigazione/captcha/delay) → **Opus 4.8** o locale (llava) per il volume.
  - Testi inviati (invite note, message, follow-up, reminder, decoy) → **Sonnet 4.6** ($3/$15): credibile
    a costo medio, volume medio-alto; Opus solo per i messaggi più delicati.
  - Batch offline (leadScorer, leadDataCleaner, companyEnrichment, sentiment) → **Haiku 4.5** ($1/$5) per
    dati PII lead (Anthropic, GDPR-safe) | **Gemini 2.5 Flash-Lite** ($0.10/$0.40) per volume non-PII.
    EVITARE DeepSeek/Qwen su dati personali dei lead (residenza dati/GDPR).
  - Embeddings (dedup semantico) → restano locali (nomic-embed-text): basso valore di cambio.
  - DONE: ogni call-site instradato al tier deciso via routing centralizzato; rimossi model id hardcoded
    (COMPUTER_USE_MODEL='gpt-5.4' computerUse.ts:79, default 'gpt-4o' costruttore vision).
  - VERIFY: grep model id hardcoded fuori dal router = 0; conta-problemi exit 0; costo/1000-azioni PRIMA/DOPO.

- [x] **F3 — Cervello + segnali live** — **DONE 2026-06-11** (eseguibile completato; dettaglio: worklog F3+F4).
  - F3.1 `97f65cb`: classifyIncidentSource RIPARATA (era orfana e rotta: tabella `incidents` inesistente),
    repository PG-portabile, WIRED in quarantineAccount (alert WHAT/WHY/DO + liveEvent; fail-safe invariato).
  - F3.2 P(accept): GIÀ ESISTENTE verificato — scheduler.ts:740 riordina con predictAcceptanceBatch.
  - F3.3 self-healing selettori: GIÀ ESISTENTE verificato — uiFallback (LLaVA locale) → selectorLearning
    (promozione + dry-run + auto-rollback su degradazione).
  - F3.4 `d6cbb14`: inbox_reply wired nell'inboxWorker (gate additivo, solo-blocco, strict, pre-cap).
  - Residuo CON CAUSA: accuracy post-anonimizzazione + classificatore account-aware pieno richiedono
    RUN LIVE / counter selector_failures per-account (monitoraggio già cablato via decisionFeedback).
  - VERIFY: conta-problemi exit 0 per commit; 174 file / 1710 test; antiban SICURO.
  - Stato reale: il brain ESISTE e il feedback loop è REALE (decisionFeedback→leadStateService outcome,
    accuracy ri-iniettata nel prompt). MA è cieco a fingerprint/proxy/JA3/challenge realtime e decide
    solo 5 punti hardcoded. Gate di sicurezza (risk/STOP/pending/varianza/timing) restano rule-based
    BY-DESIGN — l'AI può solo ESCALARE/ridurre, mai ammorbidire o aumentare volumi (preservare!).
  - Dove l'AI aggiunge valore REALE e sicuro (ordine di priorità):
    1. **classifyIncidentSource** (account-specific vs platform-wide) — oggi ORFANA + SQLite-only nel
       catch vuoto (bug): WIRE + rendere PG-portabile, poi classificatore AI account-aware. Alto valore:
       oggi SELECTOR_FAILURE_BURST senza accountId quarantina TUTTI per un cambio DOM.
    2. **Ordinamento candidati per P(accept) appreso** (ml/acceptanceProbability) — anti-ban-POSITIVO
       (abbassa pending alla fonte, cambia solo la priorità, non volumi/timing).
    3. **Self-healing selettori** via vision→selectorLearning (candidati con review, mai auto-apply).
    4. ban-probability/trust con pesi appresi SOLO con ground-truth di ban etichettati (oggi assente).
  - DONE: i decision-point scelti ricevono i segnali mancanti; modello del cervello = quello di F2
    (Opus/Fable); confermato che la decisione cambia il comportamento (non solo log).
  - VERIFY: conta-problemi exit 0 + antiban SICURO + un decision-point tracciato segnale→decisione→azione.

- [x] **F4 — Dipendenze/health** — **DONE 2026-06-11** (commit `e0239d5`): ramo H28 fallback ESEGUIBILE
  (requestOpenAIText accetta baseUrl/model dalla resolution; circuitKey dedicata `ollama.fallback.chat`);
  gate remoto invariato e testato. Causa storica del breaker aperto = AMBIENTALE (endpoint AI configurato,
  default Ollama locale, non raggiungibile) → documentata; "run sano" verificabile con Ollama attivo.
  VERIFY: conta-problemi exit 0; test dispatch H28 + sentinella circuit key.

- [x] **F5 — Housekeeping** — **DONE 2026-06-11**: ENGINEERING_WORKLOG (entry F2 + F3/F4), questo binding,
  decisione modelli in `~/memory/` (project memory `ai_model_matrix.md`), lastchat save a fine sessione.

## DECISIONE UTENTE 2026-06-11 (data-residency = ZERO PII AL CLOUD) — vincola F0/F2/F3
«Claude sui punti critici, locale sul resto per i dati lead» + «ZERO PII al cloud, sposta anche i testi in locale.»
Principio FORTE: nessun dato personale del lead (nome, email, telefono, URL profilo, azienda specifica,
screenshot che lo mostra) esce verso un provider cloud.

- **LOCALE Ollama (PII del lead)**: generazione testi inviati (invite note/message/follow-up/reminder — serve il
  nome reale), leadScorer, leadDataCleaner, companyEnrichment, sentimentAnalysis, intentResolver draft, embeddings.
- **TENSIONE da risolvere (zero-K/zero-B)**: «cervello/vision/computer-use potenti su Claude» CONFLIGGE con
  «zero PII al cloud», perché quei punti VEDONO PII:
  - aiDecide/guardian ricevono profilo+enrichment (nome/headline/seniority/email...) → PII.
  - computer-use (Fable) e vision-critica mandano SCREENSHOT di Sales Navigator/LinkedIn → PII visiva (nomi).
- **SOLUZIONE proposta = PSEUDONIMIZZAZIONE (abilita Claude cloud sul cervello senza PII)**: il cervello gira su
  Claude cloud (Opus/Fable) ma riceve SOLO feature NON-identificative (segmento, seniority, industry, regione
  coarse, connectionDegree, scores, ratios, riskSnapshot) — mai nome/email/telefono/URL/azienda. Decidere
  invio-sì/no e pacing NON richiede l'identità. → nuovo task F0.5: layer di pseudonimizzazione prima del cloud.
- **RISOLTA 2026-06-11 (default applicato = zero-PII rigoroso)**: l'utente ha chiesto il quadro GDPR ("i lead
  pubblici sul cloud sono un problema?"). Risposta data: "pubblico" NON esenta dal GDPR (cfr. Clearview); mandare
  PII al cloud è legale SOLO con base giuridica + DPA + trasferimento USA (DPF/SCC) + zero-retention + minimizzazione
  + informativa. Lo screenshot è il caso peggiore (PII di massa + terzi). → DECISIONE: vision/computer-use restano
  LOCALI (LLaVA + stack selettori), gli screenshot NON escono. Computer-use Fable cloud = OPZIONE FUTURA spenta,
  accendibile solo dopo aver messo a posto DPA+zero-retention+informativa. Il cervello su cloud va SOLO pseudonimizzato
  (feature anonime = fuori dalla definizione di dato personale → niente DPA/trasferimento). [non è parere legale]
- CONSEGUENZA: con zero-PII, su Claude CLOUD restano: cervello PSEUDONIMIZZATO (Opus/Fable) + task SENZA dati lead
  (decoyTermsGenerator, postContentGenerator warmup, ragionamento strategico/config aggregato). Tutto il resto locale.
- Mai PII a provider non-DPA (no DeepSeek/Qwen comunque). → SUPERSEDE le righe Haiku(PII)/Gemini-Flash e
  "testi su Sonnet" delle versioni precedenti di F2.

## REQUISITO PRODOTTO 2026-06-11 (vendibile / produzione / multi-tenant) — vincolo TRASVERSALE su tutte le fasi
L'utente: «non è detto che lo usi solo io sul mio PC» → progettare per un futuro prodotto venduto, SENZA
costruire la multi-tenancy ora (zero-I: la porta aperta, non la stanza).
- **Principio**: nessuna scelta AI hardcoded sul setup dell'utente. Tutto CONFIG-DRIVEN e per-tenant-ready:
  provider, model id, chiavi API, budget/cap, base-url locale → per-deployment/per-account, mai costante nel codice.
- **F0 provider-agnostico diventa OBBLIGATORIO** (non opzionale): cablare providerRegistry come selettore reale
  per-deployment (on-prem locale | cloud Claude | ibrido). È il prerequisito anche del prodotto, non solo del refactor.
- **F0.5 pseudonimizzazione = FEATURE DI PRODOTTO + selling point** ("i dati dei tuoi lead non vanno mai al cloud"),
  non solo scelta personale. Rafforza F0.5, non la cambia.
- **"Locale" dipende dallo scenario di vendita** (da decidere quando vicino alla vendita, NON ora — design comune
  copre tutti): self-hosted = Ollama sull'hardware del CLIENTE (no GPU forte assunta → modello locale leggero +
  fallback cloud opzionale) | SaaS = Ollama sui TUOI server (infra GPU + isolamento dati per-tenant + DPA a catena,
  diventi responsabile/sub-responsabile) | ibrido. La quarantena per-account (G5-F2 già fatta) è il primo mattone
  multi-tenant.
- **Costo AI = voce di margine** con N clienti → tier "locale economico" vs "cloud premium" abilitati dal design
  provider-agnostico. Il criterio costo/1000-azioni di F2 va letto anche come costo-per-cliente.
- **NON ora (zero-I)**: isolamento per-tenant runtime, billing/metering, infra SaaS — si aggiungono alla decisione
  di business, senza rifare F0/F0.5/F2/F3.

## Vincoli
- Anti-ban: ogni edit su src/ai|salesnav|risk = 5 domande pre-merge. Niente modifiche con run attivo.
- Push: manuale su richiesta di Riccardo (repo personale, NON condiviso — corretto 2026-06-11; mai auto-push su commit anti-ban). Modifiche a codice vivo INLINE, mai delegate a workflow.
- Qualità > prezzo dove la decisione conta (anti-ban/risk/vision); prezzo dove il task è volume/basso-rischio.
