# linkedin-os-dashboard — sito web locale "OS" che mostra e fa girare TUTTO il sistema LinkedIn

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: git log -40 repo Linkedin (fino a 2026-07-03) = 100% anti-ban/enrichment/sync-search, ZERO commit dashboard-OS; `dashboard/pages` Mar30 e `public/index.html` Mar29 = intatti dalla creazione tracker (2026-06-08). NON in GOAL REGISTER (active.md:13-34) → `/goal linkedin-os-dashboard` mai lanciato. Deprioritizzato: priorità LinkedIn 2026-06-12 = anti-ban+preset (active.md:95). Elencato tra i 16 freddi control-plane (maintenance/2026-07-03.md:26). Non assorbito: ai-dashboard/os-ui = dashboard AI-Con…
> Azione/causa: NON archiviare, NON marcare [x]: tutti i 7 checkbox (Task 0-6) sono lavoro reale mai iniziato. Aggiungere in testa al tracker la CAUSA: "goal mai lanciato, deprioritizzato 2026-06-12 a favore di anti-ban/backend-audit; feature a codice-vivo gated su lancio /goal (regola 2026-06-08)". Prossimo passo concreto: Task 0 (MAPPA esistente dashboard/ vs public/ + doc 1-pagina flusso UI→API→queue→bot) è read-only e può partire senza gate; gli edit a codice-vivo (Task 2-6) attendono il lancio del goal. Blocco demo: proxy Oxylabs esaurito → workflow reali non girano finché non si ricarica (o dry-run).


> Binding `/goal linkedin-os-dashboard`. Creato 2026-06-08. Progetto NUOVO, prossima chat.
> Branch `refactor/adk-split` (peer Codex). Gate: `npm run conta-problemi` exit 0.

## End-state (misurabile)
Un **sito web locale** (dashboard "OS") che:
1. **Mostra come funziona l'intero sistema LinkedIn bot** — tutti i workflow/azioni (invite, message, follow-up, sync search/list, site-check, inbox, scraping, risk/antiban status, lead pipeline) in una UI chiara e fatta bene.
2. **Funziona DAVVERO**: clicco un workflow → il workflow **parte realmente** (enqueue su `automation_commands` → il bot lo esegue → stato/risultato visibile live nella UI). Non un mockup: azione → esecuzione → feedback.
3. **UI di qualità** (l'utente ha insistito "fatto per bene"): responsive, dark mode, stati loading/error/empty, real-time (WebSocket già presente: `src/api/wsAuth.ts`), accessibile.
4. **In locale per ora** (demo da far vedere come funziona). Niente deploy prod in questa fase.

## REGOLA D'ORO (zero-A/D): NON ricostruire — c'è già una base. MAPPARE PRIMA.
Esiste già (grounded 2026-06-08, `git fdc862d`):
- **2 frontend**: `dashboard/` (Next.js: `pages/index.js`, `pages/_app.js`, Tailwind, `lib/supabaseClient.js`) **E** `public/` (`index.html` + `assets/bundle.js` + `sw.js`). → **TASK 0: capire quale è la UI live, se consolidare in una sola** (non lavorare a caso su entrambe).
- **API backend**: `src/api/server.ts`, `src/api/routes/controls.ts`, `src/api/routes/health.ts`, `src/api/dashboardSession.ts`, `src/api/wsAuth.ts` (auth + WebSocket realtime).
- **Bridge workflow (il cuore di "click → parte")**: `src/core/repositories/automationCommands.ts` (coda `automation_commands`). Contratto già testato: `src/tests/workflowApiContract.vitest.ts`, `automationBridge.vitest.ts`, `e2e-dashboard.vitest.ts`, `dashboardSession.vitest.ts`.
- **Client frontend**: `src/frontend/apiClient.ts`.
- Avvio: `npm run dashboard:dev` (`ts-node src/index.ts dashboard`).

## Task (ordine; ogni task: criterio DONE + VERIFY)
- [ ] **0. MAPPA l'esistente** (code-explorer / lettura): dashboard/ vs public/ (quale live), API routes, automationCommands queue, contratto workflow, WebSocket. DONE = doc 1-pagina del flusso reale UI→API→queue→bot. VERIFY = `npm run dashboard:dev` parte + screenshot UI attuale.
- [ ] **1. BRAINSTORM UX** (`superpowers:brainstorming` — è feature >2h): cosa mostra l'"OS", quali workflow, layout, come si vede "il workflow sta girando". DONE = design condiviso.
- [ ] **2. Consolidare/scegliere il frontend** (DECIDE: estendere `dashboard/` Next.js — probabile scelta migliore — o `public/` bundle). DONE = una UI di lavoro chiara.
- [ ] **3. Wire workflow REALI**: ogni bottone workflow → POST API → `automationCommands` enqueue → il bot esegue → stato live (WS) in UI. DONE = clicco e PARTE per davvero (almeno un workflow end-to-end osservabile). VERIFY = e2e-dashboard test + demo manuale.
- [ ] **4. UI fatta bene** (frontend-design + ui-ux-pro-max + emil-design-eng): stati loading/error/empty, dark mode, responsive, realtime, a11y. Review con agent `dashboard-ui-reviewer`.
- [ ] **5. Tutti i workflow del sistema** coperti nella UI (non solo uno). DONE = mappa completa workflow visibile+azionabile.
- [ ] **6. Gate verde**: `npm run conta-problemi` exit 0. Commit.

## Skill/agent adatti (l'utente: "usando le skill adatte")
- `superpowers:brainstorming` (PRIMA del design), `feature-dev:code-explorer` (mappa esistente).
- `frontend-design`, `ui-ux-pro-max`, `emil-design-eng`, `nextjs-developer`/`react-expert` (è Next.js).
- `fullstack-guardian` (UI↔API↔DB end-to-end), `dashboard-ui-reviewer` (agent, review UI).
- `playwright-expert`/`webapp-testing` per verificare che i click facciano partire davvero i workflow.

## Vincoli
- **Anti-ban**: la UI fa girare workflow VERI → ogni azione passa per il risk engine/antiban esistente (non bypassare cap/pending/proxy). Far PARTIRE un workflow ≠ saltare i gate.
- **Proxy**: traffico Oxylabs `linkedinproxy_1skgm` ESAURITO (1GB free) → i workflow LinkedIn reali non gireranno finché non si ricarica. Per la DEMO locale: o si ricarica il proxy, o si mostra il flusso con un workflow safe/dry-run. (Vedi sessione precedente.)
- Plan Mode + l'utente lancia `/goal linkedin-os-dashboard` PRIMA che parta la modifica al codice (regola 2026-06-08).
