# Audit TODO_MIGLIORAMENTI.md — Gap, Parziali e Rimandati (L1-L6 + Anti-Ban)

Analisi di ogni punto del `TODO_MIGLIORAMENTI.md` marcato `[x]` ma che contiene language di incompletezza: "PARZIALMENTE", "fase 2 futura", "restano come miglioramenti futuri", "NON ORA", "RIMANDATA", "PREMATURA", "incrementale", "sessione dedicata".

**Totale punti**: ~150 marcati `[x]`  
**Completati realmente**: ~120  
**Parziali/rimandati/con debito residuo**: ~30 (elencati sotto)

---

## SEZ. 1 — Frontend (4 gap)

### 1.1 — `main.ts` split: `controls.ts` non estratto
**Claim**: "Eventuale ulteriore estrazione di `controls.ts` (~190 righe di bindControls) è opzionale"  
**Stato reale**: main.ts ora a 552 righe (sotto 600 dopo nostro fix), ma `bindControls` è ancora inline  
| L1 | ✅ Compila, test OK |
| L2 | ✅ Funzionale |
| L3 | ✅ Nessun edge case |
| L4 | ✅ Nessun rischio |
| L5 | ✅ Utente non nota differenza |
| L6 | ⚠️ File potrebbe ricrescere sopra 600 se si aggiungono feature |
| Anti-Ban | N/A |
**Verdict**: Debito tecnico minore, accettabile. Estrarre solo se main.ts ricresce.

### 1.2 — Design tokens: `design-tokens.css` separato non creato
**Claim**: "Centralizzare in un `design-tokens.css` importato da `style.css`"  
**Stato reale**: I token `:root` + `[data-theme="dark"]` sono IN `style.css`, non in file separato  
| L1-L6 | ✅ Funzionalmente completo — i token esistono |
| Anti-Ban | N/A |
**Verdict**: Completato di fatto. Il file separato è una preference organizzativa, non un gap funzionale.

### 1.3 — React/Vite: decisione NON ORA
**Claim**: "Se in futuro il frontend cresce oltre 5000 righe o serve multi-utente, rivalutare"  
| L1-L6 | ✅ Decisione strategica documentata |
**Verdict**: ✅ Decisione corretta. Non è un gap.

### 1.4 — `drop:['console']` per produzione non implementato
**Claim**: "Aggiungere anche `drop:['console']` per produzione (opzionale)"  
| L1 | ✅ Build funziona senza |
| L3 | ⚠️ Console.log in produzione potrebbe leakare info nei dev tools del browser |
| L6 | ⚠️ Bundle size leggermente più grande |
**Verdict**: Debito minore. `drop:['console']` è un'ottimizzazione opzionale.

---

## SEZ. 2 — Backend (7 gap)

### 2.1 — Config profiles: validazioni cross-dominio (parte b) e `.env.example` raggruppamento (parte c)
**Claim**: "Parti (b) validazioni cross-dominio e (c) raggruppamento `.env.example` restano come miglioramenti futuri"  
**Stato reale**: Profili funzionano. Validazione cross-dominio parziale (20+ regole in `validation.ts` ma non tutte le combinazioni). `.env.example` esiste ma non raggruppato per sezione.
| L1 | ✅ Compila |
| L4 | ⚠️ Combinazioni config invalide non tutte catturate (es. `WARMUP_TWO_SESSIONS_PER_DAY=true` senza `WORKING_HOURS_START` corretto) |
| L5 | ⚠️ Utente potrebbe configurare combinazioni incoerenti senza errore |
| L6 | ⚠️ `.env.example` lungo e non organizzato per sezione |
**Verdict**: Gap reale ma basso rischio. Le validazioni più critiche (risk thresholds, caps) sono coperte.

### 2.2 — `bulkSaveOrchestrator.ts` (112KB) — solo fase 1 completata
**Claim**: "Fase 2: rimuovere copie locali nell'orchestrator e importare dal helper, poi estrarre navigazione e paginazione"  
**Stato reale**: Helper estratto ma orchestrator ancora 112KB  
| L1 | ✅ Compila |
| L2 | ⚠️ Copie locali di funzioni ancora presenti (duplicazione) |
| L6 | ⚠️ File da 112KB è il più grande della codebase — manutenibilità compromessa |
**Verdict**: **Gap medio**. File troppo grande, duplicazioni interne. Richiede sessione dedicata.

### 2.3 — Migrazione ESM: RIMANDATA
**Claim**: "Rivalutare quando una dipendenza critica diventa ESM-only"  
| L1-L6 | ✅ Decisione strategica corretta |
**Verdict**: ✅ Non è un gap. Decisione documentata.

### 2.4 — Repository pattern: 13 repository legacy non migrati
**Claim**: "I 13 repository restanti migrano incrementalmente quando vengono toccati per altre ragioni"  
**Stato reale**: Solo `riskInputCalculator.ts` usa il pattern. 13 repository restano SQL raw diretto.
| L1 | ✅ Funzionano |
| L2 | ⚠️ Pattern misto — nuovi e vecchi moduli hanno API diverse |
| L6 | ⚠️ Testabilità compromessa: repository legacy non iniettabili |
**Verdict**: Debito tecnico noto. Migrazione incrementale accettabile.

### 2.5 — `safeAsync`: 97 occorrenze legacy non migrate
**Claim**: "97 occorrenze legacy in 27 file — migrazione progressiva, non big-bang"  
| L3 | ⚠️ `.catch(() => null)` nei 27 file legacy perde il messaggio errore (non loggato) |
**Verdict**: Debito tecnico noto. La funzione esiste, l'adozione è incrementale.

### 2.6 — DI leggera: fase 2 (migrazione consumer esistenti) non fatta
**Claim**: "Fase 2 (migrazione consumer esistenti) è incrementale"  
**Stato reale**: `AppContext` creato, `createTestAppContext` disponibile. 0 consumer esistenti migrati.
| L6 | ⚠️ L'infrastruttura DI esiste ma non è usata in pratica |
**Verdict**: Debito tecnico. L'architettura è pronta, l'adozione è a costo zero per file.

### 2.7 — Kysely: decisione adottare incrementalmente, 0 moduli migrati
**Claim**: "Primo candidato per adozione: il prossimo repository nuovo"  
**Stato reale**: Nessun modulo usa Kysely. `kysely` non è nemmeno nelle dependencies.
| L1 | ⚠️ Kysely non installato — la decisione è solo sulla carta |
| L6 | ⚠️ Nessun beneficio realizzato |
**Verdict**: Debito tecnico. Decisione presa ma mai implementata.

---

## SEZ. 3 — Anti-Ban (1 gap)

### 3.1 — Test stealth con browser headless reale
**Claim**: "Test con browser headless reale (Playwright in test mode) è un task futuro"  
**Stato reale**: 16 test verificano il JS generato (string contains), non l'esecuzione reale in un browser.
| L1 | ⚠️ I test verificano che il codice JS sia presente, non che funzioni nel browser |
| L3 | ⚠️ Un bug JS runtime (es. TypeError su proprietà non writable) non viene catturato |
| Anti-Ban | ⚠️ Se uno stealth script fallisce silenziosamente, il bot è esposto alla detection |
**Verdict**: **Gap medio-alto per anti-ban**. Test in-browser per stealth è un investimento critico.

---

## SEZ. 4 — Sicurezza (3 gap)

### 4.1 — TOTP: fase 2 — ✅ ORA COMPLETATA (nostro fix P1-1)
**Claim originale**: "Fase 2: integrare nel dashboardAuthMiddleware"  
**Stato attuale**: Wired in `/api/auth/session` con auth check + TOTP verification  
**Verdict**: ✅ **COMPLETATO** dal nostro intervento.

### 4.2 — Form-based login (sostituzione auth via query string)
**Claim**: "Il fix completo (form POST login) è un task frontend separato"  
**Stato reale**: L'auth avviene ancora via `?api_key=XXX` nella URL → esposta nei log server, browser history, referrer.
| L3 | ⚠️ API key in URL → visibile in access log, browser history, referrer header |
| L4 | ⚠️ Se qualcuno copia l'URL con api_key, ha accesso permanente |
| L5 | ⚠️ Utente non ha un form di login — deve incollare URL con key |
**Verdict**: **Gap medio per sicurezza**. L'API key in URL è una pratica sconsigliata.

### 4.3 — Checklist periodica: parte (b) coerenza config vs doc
**Claim**: "La parte (b) richiede parsing strutturato dei doc ed è un task futuro di bassa priorità"  
| L6 | ⚠️ Nessun check automatico che la doc rifletta la config reale |
**Verdict**: Debito minore. Il security advisor copre la parte (a) — freshness.

---

## SEZ. 5 — Database (2 gap)

### 5.1 — Test DB PostgreSQL reale in CI
**Claim**: "Fase 2 (test con DB PG reale per migrazioni + json_set→jsonb_set) richiede infrastruttura PG in CI"  
**Stato reale**: CI ha un servizio PG (ci.yml riga 57-69 `postgres:16`) ma i test di coerenza usano solo normalizzazione string, non esecuzione reale.
| L1 | ⚠️ `dbCoherence.vitest.ts` testa solo la normalizzazione SQL, non l'esecuzione su PG reale |
| L4 | ⚠️ Un bug `json_set`→`jsonb_set` non verrebbe catturato |
**Verdict**: **Gap medio**. L'infrastruttura PG è già nel CI — manca solo il test.

### 5.2 — Partitioning PostgreSQL: PREMATURA
**Claim**: "Rivalutare dopo 6 mesi di produzione su PG"  
**Verdict**: ✅ Decisione corretta. Non è un gap.

---

## SEZ. 6 — Test & CI (5 gap)

### 6.1 — `unit.vitest.ts`: test legacy monolitico da ~900 righe non spezzato
**Claim**: "legacy core domain (il test monolitico da ~900 righe) restano da estrarre"  
| L1 | ⚠️ Un singolo test di ~900 righe è fragile: un failure blocca tutto |
| L5 | ⚠️ Difficile capire cosa è fallito senza leggere 900 righe |
**Verdict**: Debito tecnico medio. Il test funziona ma è poco manutenibile.

### 6.2 — `integration.ts` (78KB) non migrato a vitest
**Claim**: "richiede sessione dedicata per migrazione a vitest"  
**Stato reale**: File da 78KB che gira con `ts-node`, non con vitest. Non contribuisce ai 136 test vitest.
| L1 | ⚠️ I test integration non sono nel coverage vitest |
| L6 | ⚠️ Due framework test diversi (vitest + ts-node custom) → confusione |
**Verdict**: **Gap medio**. 78KB di test fuori dal framework standard.

### 6.3 — E2E: mock server per workflow LinkedIn
**Claim**: "Fase 2: mock server Express con JSON fixtures per workflow LinkedIn"  
| L1 | ⚠️ Nessun test E2E copre il workflow reale (login→schedule→jobRunner) |
**Verdict**: Gap medio. I test E2E coprono solo health/metrics/404.

### 6.4 — E2E Dashboard: Playwright con browser reale
**Claim**: "Fase 2 (Playwright Test con browser reale per interazione UI)"  
| L1 | ⚠️ I 5 test e2e-dashboard verificano solo HTML/CSS statico, non interazione |
**Verdict**: Gap medio. Nessun test verifica click/SSE/search nella dashboard.

### 6.5 — Coverage threshold: 50% nel CI vs 60% dichiarato come target
**Claim**: "es. 60% come baseline, poi incrementare"  
**Stato reale**: CI usa `--coverage.thresholds.lines=50`, non 60%.
| L1 | ⚠️ Soglia più bassa del dichiarato |
**Verdict**: Gap minore. 50% è già applicato.

---

## SEZ. 7 — AI (3 gap)

### 7.1 — Fallback OpenAI→Ollama automatico
**Claim**: "(c) Fallback OpenAI→Ollama automatico resta come miglioramento futuro — attualmente OpenAI→template"  
**Stato reale**: `providerRegistry.ts` fa OpenAI→template. `HybridVisionProvider` fa OpenAI→Ollama ma solo per vision, non per testo.
| L3 | ⚠️ Se OpenAI è down per testo, si ricade su template (non su Ollama locale) |
| L5 | ⚠️ Utente con Ollama configurato non beneficia del fallback per messaggi/note |
**Verdict**: **Gap medio per qualità output**. Ollama disponibile ma non usato come fallback testo.

### 7.2 — RAG: PREMATURA
**Verdict**: ✅ Decisione corretta.

### 7.3 — AI Guardian: logging passivo ma nessun blocco attivo
**Claim**: "AI_GUARDIAN: logging passivo"  
| L5 | ⚠️ Il guardian logga ma non blocca messaggi potenzialmente dannosi |
**Verdict**: Debito minore. Il guardian è un layer informativo, non bloccante.

---

## SEZ. 8 — DevOps (1 gap)

### 8.1 — Sentry/APM: solo Prometheus
**Claim**: "Sentry resta come miglioramento futuro"  
| L6 | ⚠️ Nessun error tracking centralizzato con stack trace — solo log e metriche |
**Verdict**: Debito minore. Prometheus + Telegram copre il monitoring base.

---

## SEZ. 9 — Findings Critici (0 gap)
Tutti i finding critici risultano realmente completati.

---

## SEZ. 10-11 — Pulizia (1 gap)

### 10.1 — `src/services/` directory vuota non rimossa
**Claim**: "Rimuoverla oppure usarla come target per separazione business logic"  
| L6 | ⚠️ Directory vuota nel repository — rumore |
**Verdict**: Gap cosmetico. Un `rmdir` risolve.

---

## SEZ. 12 — CLI (0 gap)
Tutti i comandi documentati, alias deprecati gestiti. ✅ commandHelp completato dal nostro fix.

---

## SEZ. 13 — Performance (2 gap)

### 13.1 — Parallelizzare sync Supabase e cleanup outbox durante delay
**Claim**: "Punti (c) sync Supabase e (d) cleanup outbox restano come miglioramenti futuri"  
| L3 | ⚠️ Outbox può crescere se non pulito regolarmente |
**Verdict**: Debito minore. Cleanup è nel loop tra i cicli.

### 13.2 — Navigazione login con `'load'` invece di `'domcontentloaded'`
**Claim**: "L'unico `'load'` è in `utilCommands.ts` per la pagina login — corretto"  
| Anti-Ban | ✅ Corretto — form login deve caricare completamente |
**Verdict**: ✅ Non è un gap.

---

## SEZ. 14 — Anti-Detection (0 gap)
Tutti i punti verificati come completati.

---

## SEZ. 15 — Strategico (0 gap residuo)
CycleTLS rimosso, voice commands rimosso, fake storage rimosso, doppia WebGL risolta.

---

## SEZ. 16 — Best Practice End-to-End (0 gap)
Tutte le 6 fasi verificate come complete.

---

## RIEPILOGO

| Priorità | Count | Gap |
|----------|-------|-----|
| **ALTO** | 3 | Test stealth in-browser, bulkSaveOrchestrator 112KB, form-based login |
| **MEDIO** | 8 | Test PG reale in CI, integration.ts 78KB non migrato, E2E workflow, E2E dashboard Playwright, fallback AI OpenAI→Ollama, unit.vitest legacy, config validazioni cross-dominio, Kysely mai installato |
| **BASSO** | 8 | controls.ts non estratto, drop:['console'], 13 repository legacy, safeAsync 97 occ., DI fase 2, coverage 50 vs 60, Sentry, services/ vuota |
| **DECISIONI (non gap)** | 5 | React/Vite, ESM, Redis/BullMQ, Partitioning PG, RAG |

### Top 3 azioni raccomandate (rapporto impatto/effort):

1. **Test stealth in-browser** — rischio anti-ban se uno script fallisce silenziosamente. Effort: 1 sessione (Playwright test con `page.evaluate`). Impatto: alto per anti-ban.

2. **Fallback AI OpenAI→Ollama per testo** — 1 modifica in `providerRegistry.ts` (aggiungere Ollama come step prima di template). Effort: 10 minuti. Impatto: qualità messaggi quando OpenAI è down.

3. **Form-based login frontend** — sostituire `?api_key=XXX` con form POST. Effort: 1 sessione. Impatto: sicurezza (API key non più in URL).
