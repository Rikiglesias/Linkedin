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

## 3. Memoria AI (secondo cervello)

- [ ] `MEMORY.md` come indice (non contenitore)
- [ ] File memoria separati per tema: utente, feedback, progetto, referenze
- [ ] `user.md`: chi è l'utente, come lavora
- [ ] `decisions.md`: decisioni motivazionali non derivabili dal codice
- [ ] `todos/active.md`: priorità correnti
- [ ] Aggiornamento proattivo a fine sessione significativa

## 4. Quality gates (L1-L9)

- [ ] Build passa (exit code 0) prima di iniziare
- [ ] TypeScript strict mode attivo
- [ ] Test coverage su logica critica
- [ ] `npx madge --circular` = 0
- [ ] Lint/prettier configurati
- [ ] L7 (multi-dominio per file) applicato a ogni modifica significativa
- [ ] L9 (loop finale) prima di dichiarare DONE

## 5. Hook system (`settings.json`)

- [ ] `PreToolUse` bloccante su file sensibili del dominio
- [ ] Hook antiban usa `permissionDecision: "deny"` (non bypassabile)
- [ ] `PostToolUse` asincrono su comandi qualità
- [ ] `Stop` hook per log sessione
- [ ] Log hook in `memory/quality-hook-log.txt`
- [ ] Log antiban in `memory/antiban-hook-log.txt`

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

- [ ] Loop automatico su ogni task (senza dire "usa il loop")
- [ ] Web search obbligatoria prima di ogni implementazione significativa
- [ ] L1-L9 applicati senza essere richiesti
- [ ] Skill/MCP/agente scelti autonomamente
- [ ] Regole critiche tutte in hook (non solo in testo)
- [ ] Workflow n8n girano in autonomia negli orari giusti
- [ ] Nessuna "false completion" — L9 verde prima di DONE

---

## Score rapido

Conta i ✅ e dividi per il totale. Target: >80% per produzione, >90% per sistemi critici.

| Area | Check totali |
|------|-------------|
| Struttura codice | 6 |
| Regole AI | 5 |
| Memoria AI | 6 |
| Quality gates | 7 |
| Hook system | 6 |
| Skill | 6 |
| n8n workflow | 7 |
| Sicurezza | 9 |
| Anti-ban | 9 |
| Parità ambienti | 4 |
| Manutenzione | 6 |
| Osservabilità | 5 |
| Test | 4 |
| Strumenti personali | 4 |
| Autonomia AI | 7 |
| **Totale** | **101** |
