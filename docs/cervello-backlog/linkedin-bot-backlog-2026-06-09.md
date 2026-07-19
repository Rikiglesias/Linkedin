# LinkedIn Bot — backlog post-sync-funzionante (2026-06-09 notte)

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: Residuo VIVO: (3-antiban) user-actions-pending.md:79 «proxy mobile lento, valutare Oxylabs mobile→residential (leva utente)» + improvements-proposed.md:210-215 geoip-exit/resource-blocking ancora «proposta». (4) last_synced_at usato solo per ORDER BY (leadsCore.ts:299-300), non come segnale count/hash per skip re-sync. (7) analisi web bloccata su spiegazione utente. GIA CHIUSI/ASSORBITI: (5) .env:250 AI_MODEL=gpt-5.4 cloud-primary + ai-stack DONE; (8) audit-orchestrator-fix.md A1-A5/D1-D3/R1 tut…
> Azione/causa: NON marcare CHIUSO (tocca anti-ban proxy). Nel file: (a) marca [x] item 5 (AI brain → ai-stack.md) e item 8 (audit orchestratore → audit-orchestrator-fix.md, tutto chiuso) con puntatore; (b) barra come stale gli item 1/2 (demo passata) e item 9 (ferry gpt55, branch inesistente, config atterrata gpt-5.4); (c) SCORPORA i 3 residui vivi verso i loro SSOT: item 3 proxy → gia in user-actions-pending.md:79 + improvements-proposed.md:210-215 (lascia solo puntatore), item 4 sync-intelligente → sync-list-fix.md, item 7 analisi-web → resta bloccato su leva utente; (d) dopo lo scorporo il file resta solo…


> Milestone RAGGIUNTA: `sync-list` gira e scrapa lead (Pagina 1-4, 25 candidati/pagina) e salva nel DB.
> Run con `--no-proxy` + `SELECTOR_CANARY_ENABLED=false`. Chiuso dall'utente (SIGINT) per andare a letto.
> Commit chiave sessione: `4393bcc` (diagnosi canary), `327e329` (login goto robusto), `9bf5552` (listUrl validato).
> Questo file = gli 8 punti che l'utente ha dettato prima di andare a letto. Ordine = priorità reale (demo domani prima).

## 🔴 P0 — DEMO DOMANI (time-critical, 2026-06-10)
- [x] **Presentazione per il Presidente CNA Bologna** — EVOLUTA: il deck `bot-linkedin-cna.html` era "terribile" → sostituito da **pagina web "OS"** `docs/presentazione/linkedin-bot-os.html` (6 aree: Panoramica/I 4 Workflow/Ecosistema/Sicurezza/Architettura/Roadmap), verificata Playwright, inviata. Aprire dalla cartella (usa `infografica-sistema.png` relativa). **NotebookLM** collegato+usato (notebook `40879073…`) per infografica + mind-map.
- [ ] **Opzioni "altro" proposte da me (in attesa OK utente)**: (a) **audio overview ~5 min** via NotebookLM (`notebooklm generate audio` dal notebook 40879073) — riassunto parlato per il presidente; (b) **sezione Risultati/Numeri con dati VERI dal DB** (oggi KPI di esempio); (c) **caso d'uso su misura CNA** (impresa artigiana BO trova clienti/fornitori); (d) **dashboard interattiva vera** (OS collegato al DB live = step grosso).
- ⚠️ NOTA OPERATIVA AI: NON fare `rm -rf .playwright-mcp` (contiene file TRACCIATI del 18/04) — cancella solo i propri screenshot per nome. Ripristino: `git checkout -- .playwright-mcp/`.
- [ ] **(collegato) Sito/dashboard di controllo** — l'utente vuole anche il sito per controllare il sistema (utile pure alla demo). Esiste già `npm run dashboard:dev` (dashboard locale Next.js). Da verificare stato/funzionalità + valutare se mostrarla alla demo.

## 🔴 ANTI-BAN / OPERATIVITÀ
- [ ] **Far funzionare sync col PROXY** (oggi solo `--no-proxy`). Root noto: proxy MOBILE serializza connessioni → browser 85s/nav, canary timeout 30s. Fix vero = proxy RESIDENTIAL (leva utente Oxylabs) OPPURE bot-side: alzare timeout canary/nav + resource-blocking. ⚠️ login-IP deve = operatività-IP (ri-login ATTRAVERSO il proxy). Dettaglio: `improvements-proposed.md` 2026-06-09 + `user-actions-pending.md`.
- [x] **Mouse perso sul 2° monitor** ✅ FATTO (commit `2cca1d4`): fix `-EncodedCommand` (base64 UTF-16LE) al posto di `-Command` inline che rompeva l'here-string. Verificato A/B reale + 3 test, gate 1595. = bug `[WINDOW-BLOCK]` (here-string PowerShell malformata in WinInputBlock click-through → SetClickThrough fallisce → l'overlay input-block non diventa click-through → mouse bloccato/perso passando schermo). Fix: script C# via file `.ps1` o `-EncodedCommand`, non here-string inline in `-Command`. Già tracciato in `improvements-proposed.md`. Gated (anti-ban: input-block protegge l'automazione). **Impatto demo**: se mostra il bot dal vivo, il mouse si incarta → priorità ALTA anche per domani.

## 🟡 INTELLIGENZA / QUALITÀ
- [ ] **Sync liste INTELLIGENTE** (richiesta utente): oggi per capire se una lista è aggiornata fa un confronto stupido nome-per-nome avanti/indietro col DB = lunghissimo. Serve un **segnale a livello-lista** (es. count totale lista vs count DB, o data ultimo aggiornamento/hash della lista da SalesNav) per decidere se ri-sincronizzare, invece dello scan per-lead. Cercare se SalesNav espone count/updated-at della lista. Da investigare alla fonte (listScraper/extractSavedLists + salesnav_lists schema ha già `last_synced_at`).
- [ ] **Cervello AI / ChatGPT collegato davvero?** — verificare se l'integrazione OpenAI/gpt è realmente attiva e funziona (non Ollama fallback). Noto da sessioni precedenti: `openai.chat` era in circuit-open, default Ollama llama3.1:8b. Verificare: OPENAI_API_KEY set? AI_ALLOW_REMOTE_ENDPOINT? circuit breaker openai stato? Test reale di una chiamata. (Collegato al piano gpt-5.5 + Supervisore in `~/.claude/plans/twinkling-sauteeing-pinwheel.md`, in PR Ultraplan.)
- [ ] **Viewport browser non si adatta allo schermo** — la finestra camoufox (windowSize 1463x866 fisso) non si adatta bene allo schermo. Verificare come viene scelta la windowSize/viewport (launcher fingerprint) e renderla adattiva allo schermo reale (senza rompere la coerenza fingerprint anti-ban).

## 🟡 MANCANTI da ricordare (esplicito utente)
- [ ] **Analisi WEB non funziona** — è un **problema di GitHub** (l'utente mi dirà perché non è andata). Da riprendere quando spiega. (web search/analysis del bot o un workflow?)
- [ ] **Audit orchestratore AI non continuato coi subagenti** — l'audit profondo (Workflow `w7kggdxab`) ha trovato bug REALI anti-ban (A1 guardian fail-open → A5) + dati (D1-D3) + R1. Binding pronto: `~/todos/audit-orchestrator-fix.md`. Da riprendere coi subagenti/fix anti-ban-first.

## 🔵 PR gpt-5.5 Supervisor — FERRY dal cloud (Ultraplan bloccato)
- [ ] Il lavoro gpt-5.5 Supervisor+audit (branch `feat/gpt55-supervisor-audit`, **18 file staged, verde 1579 test, antiban SAFE**) è **intrappolato nel cloud** Ultraplan: no remote, gh assente, signing server KO (HTTP 400) → non può nemmeno committare/pushare. **`feat/gpt55-supervisor-audit` NON è su origin** (verificato `git ls-remote`). L'ambiente LOCALE invece ha origin `Rikiglesias/Linkedin` + gh + no-signing-block (push fatto 4× il 2026-06-09). **PIANO FERRY**: nel cloud `git diff --cached` → utente incolla qui → in locale: branch da `refactor/adk-split` + `git apply` + **review (anti-ban+GDPR+costi)** + merge delta locali GDPR/orario-flessibile (`~/.claude/plans/twinkling-sauteeing-pinwheel.md`) + `conta-problemi` + `git push` + `gh pr create`. Non urgente (lavoro salvo+verde). Deciso col diff-ferry perché non dipende da credenziali/signing del cloud.

## Note
- Tutti i fix gated (browser/workers/anti-ban) → `/antiban-review` + flag prima dell'Edit.
- L'utente presenta DOMANI → la presentazione (+ eventualmente dashboard + fix mouse se demo live) sono la priorità del prossimo blocco.
