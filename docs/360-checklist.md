# Checklist 360 — Nuovo progetto AI-assistito

> Checklist riusabile per portare qualsiasi progetto allo stesso livello di questo.
> Ogni sezione = un'area. Ogni riga = un check binario (✅ fatto / ❌ mancante).

---

## 1. Struttura codice

- [ ] SRP: ogni file ha una sola responsabilità
- [ ] File >300 righe → split proposto
- [ ] Nessun barrel file generico (`utils.ts`, `helpers.ts`)
- [ ] Nomi espliciti che descrivono il dominio
- [ ] Circular deps = 0 (`npx madge --circular`)
- [ ] Import/export coerenti (nessun import rotto)

## 2. Regole AI (CLAUDE.md / AGENTS.md)

- [ ] CLAUDE.md globale: regole per tutti i progetti (`~/.claude/CLAUDE.md`)
- [ ] CLAUDE.md progetto: regole specifiche (`{progetto}/CLAUDE.md`)
- [ ] File regole <300 righe (più è lungo, più regole vengono dimenticate)
- [ ] Ogni regola ha: trigger, ambito, azione, verifica
- [ ] Nessuna regola duplicata o contraddittoria
- [ ] Ogni task classifica la fonte di verita' primaria (repo, test, log, web/docs ufficiali, MCP, memoria)
- [ ] La ricerca web/docs ufficiali e' obbligatoria sui task che dipendono da fatti esterni o mutevoli
- [ ] Skill usate per procedure, MCP per stato reale esterno, hook per obblighi non dimenticabili
- [ ] Nessun flusso rigido identico per tutti i task: l'AI riconosce il caso e richiama le regole pertinenti
- [ ] La valutazione contestuale di skill, MCP, web/docs, loop, piano, workflow e quality gate parte automaticamente a ogni prompt e a ogni modifica rilevante
- [ ] L'AI spiega brevemente all'utente quali leve propone di usare e perche'
- [ ] Ogni task viene classificato anche per orizzonte temporale (breve, medio, lungo termine)
- [ ] Nessun obbligo di breve termine viene rimandato impropriamente a backlog o manutenzione futura
- [ ] Gli esempi dell'utente vengono trattati come pattern illustrativi, non come lista esaustiva
- [ ] Le allucinazioni sono vietate in senso pieno: niente fatti/stati/verifiche inventati e niente esecuzione cieca di ipotesi utente
- [ ] Se manca la primitive corretta (skill, hook, memoria, audit, workflow), l'AI riconosce il gap e propone la promozione giusta
- [ ] L'AI distingue tra automazioni che devono partire da sole e cambi durevoli o invasivi da proporre con conferma
- [ ] Audit automatici e controlli di conformita' allineati al formato reale, senza falsi verdi o falsi rossi

## 3. Memoria AI (secondo cervello)

- [ ] `MEMORY.md` come indice (non contenitore)
- [ ] File memoria separati per tema: utente, feedback, progetto, referenze
- [ ] `user.md`: chi è l'utente, come lavora
- [ ] `decisions.md`: decisioni motivazionali non derivabili dal codice
- [ ] `todos/active.md`: priorità correnti
- [ ] Aggiornamento proattivo a fine sessione significativa
- [ ] Memoria gestita su tre orizzonti: update immediato, consolidamento/handoff, pulizia periodica
- [ ] Se il contesto degrada o si compatta troppo, l'AI prepara handoff e nuova sessione invece di continuare in modo degradato

## 4. Quality gates (L1-L9)

- [ ] Build passa (exit code 0) prima di iniziare
- [ ] TypeScript strict mode attivo
- [ ] Test coverage su logica critica
- [ ] `npx madge --circular` = 0
- [ ] Lint/prettier configurati
- [ ] L7 (multi-dominio per file) applicato a ogni modifica significativa
- [ ] L9 (loop finale) prima di dichiarare DONE
- [ ] Una modifica locale viene sempre estesa al blast radius reale con file diretti/indiretti, dipendenze, test o strumenti di esplorazione adeguati

## 5. Hook system (`settings.json`)

- [ ] `SessionStart` carica memoria, todos, indice progetto e runtime brief automaticamente
- [ ] `UserPromptSubmit` reinietta il runtime brief prima di ogni nuovo prompt
- [ ] `PreToolUse` bloccante su file sensibili del dominio
- [ ] Hook antiban usa `permissionDecision: "deny"` (non bypassabile)
- [ ] `PreToolUse` bloccante su `git commit` / `git push` quando il repo non e' nello stato corretto
- [ ] `PreCompact` reinietta il runtime brief prima della compattazione del contesto
- [ ] `PostToolUse` asincrono su comandi qualità
- [ ] `PostToolUse` asincrono con audit git dopo quality gate e operazioni git rilevanti
- [ ] `Stop` hook per log sessione
- [ ] Log hook in `memory/quality-hook-log.txt`
- [ ] Log antiban in `memory/antiban-hook-log.txt`
- [ ] Log git in `memory/git-hook-log.txt`

## 6. Skill

- [ ] Tabella skill nel CLAUDE.md con trigger precisi
- [ ] Skill antiban aggiornata con vettori detection correnti
- [ ] Skill context-handoff configurata
- [ ] Skill loop-codex configurata
- [ ] Pre/post-conditions nelle skill critiche
- [ ] Audit periodico (rimuovere skill non usate da 30gg)

## 7. n8n workflow

- [ ] n8n installato e configurato (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- [ ] Workflow DevOps: quality-gate-check, bot-health-check, gdpr-retention-cleanup, weekly-report
- [ ] Workflow LinkedIn: antiban-review, campaign-analyzer, pre-production-checklist
- [ ] Workflow monitoring: linkedin-detection-monitor (lunedì 09:00)
- [ ] Nessuna credenziale hardcoded nei JSON — usare `$env.VAR_NAME`
- [ ] Pre-hook in ogni workflow (valida env, filtra weekend)
- [ ] Post-hook in ogni workflow (log timestamp + durata + esito)

## 8. Sicurezza e compliance

- [ ] Credenziali solo in `.env`, mai in codice o log
- [ ] `.env` in `.gitignore`
- [ ] DB non esposto su porta pubblica
- [ ] API/dashboard su `127.0.0.1` (non `0.0.0.0`)
- [ ] GDPR: retention policy implementata (migration SQL)
- [ ] GDPR: audit trail per ogni azione su dati personali
- [ ] GDPR: Right to Erasure supportato (script cleanup)
- [ ] Semgrep scan su moduli critici (auth, input, DB query)

## 9. Anti-ban (solo per bot su piattaforme esterne)

- [ ] Delay variabile — no pattern matematico fisso
- [ ] IP residenziali (proxy) — no VPN o datacenter
- [ ] Limite azioni giornaliere configurato (<80/giorno)
- [ ] Sessioni browser max 45 minuti
- [ ] No weekend automatico
- [ ] Fingerprint PRNG deterministico (no pattern fissi)
- [ ] Pending ratio monitorato (<65%)
- [ ] Hook PreToolUse su file sensibili del bot

## 10. Parità ambienti

- [ ] Claude Code: full capability ✅
- [ ] Codex: AGENTS.md come file canonico; `codex login` eseguito
- [ ] Ambienti secondari (Cursor/etc): limiti documentati
- [ ] Stessa task produce stesso risultato in Claude Code e Codex (test manuale)

## 11. Manutenzione e produzione

- [ ] PM2 configurato con `max_memory_restart`
- [ ] `ecosystem.config.cjs` con `cleanInheritedProxyEnv`
- [ ] Health check n8n attivo (ogni 4h lun-ven)
- [ ] Guida setup per onboarding altri (n8n + bot + PM2 + credenziali)
- [ ] Trigger manutenzione per tipo artefatto documentati
- [ ] Self-healing: memory leak → auto restart configurato
- [ ] Cadenze periodiche esplicite per code review, memoria, documenti e automazioni
- [ ] Le analisi periodiche coprono almeno file >300 righe, drift strutturale, dead code, circular deps, drift documentale e security check mirati

## 12. Osservabilità

- [ ] Log strutturati con correlationId/requestId
- [ ] Log livelli: info (flusso normale), warn (anomalia), error (fallimento)
- [ ] Nessun `console.log` in produzione per dati personali
- [ ] Alert Telegram su errori critici
- [ ] Dashboard o endpoint health check disponibile

## 13. Test

- [ ] Test su logica critica (auth, scheduler, stealth, risk)
- [ ] Test con dati reali (no mock DB per logica critica)
- [ ] `npm test` passa con exit code 0
- [ ] Nessun test che maschera bug di produzione (mock vs. reale)

## 14. Strumenti personali

- [ ] Voice dictation configurato (Whisper o OpenWhispr)
- [ ] Hotkey F9 funzionante
- [ ] Output in clipboard
- [ ] Latenza <500ms

## 15. Autonomia AI (obiettivo finale)

- [ ] Fonte di verita' scelta correttamente per ogni task, non per abitudine
- [ ] Web search obbligatoria quando il task dipende da informazioni esterne o mutevoli
- [ ] L1-L9 applicati senza essere richiesti
- [ ] Loop usato quando serve davvero, non per riflesso
- [ ] Skill/MCP/agente scelti o proposti con ragionamento esplicito
- [ ] L'AI non dimentica regole e controlli rilevanti anche se il task cambia forma
- [ ] Il commit parte come chiusura naturale di un blocco verificato, non come passaggio da ricordare a mano
- [ ] Il push viene deciso correttamente in base a branch, upstream, review e rischio operativo
- [ ] L'AI distingue correttamente cosa appartiene al breve termine, al medio termine e al lungo termine
- [ ] Regole critiche tutte in hook (non solo in testo)
- [ ] Workflow n8n girano in autonomia negli orari giusti
- [ ] Nessuna "false completion" — L9 verde prima di DONE
- [ ] Self-audit e checklist automatiche truthful rispetto al sistema reale

---

## Score rapido

Non usare score statici scritti a mano in questo file: diventano stale troppo facilmente e creano falsa autorevolezza.

Se serve una percentuale:

- contare i check in modo automatico prima di citarla
- trattare questa checklist prima di tutto come checklist binaria, non come dashboard numerica
