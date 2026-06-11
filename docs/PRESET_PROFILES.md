# Preset profili d'uso — starter · pro · scale · max-stealth

> Goal `preset-profili` (2026-06-12). 4 combinazioni COERENTI e ANTI-BAN-SICURE della
> configurazione, una per tipo d'uso. I file vivono in `presets/*.env.example`.
> Riferimento completo delle ~350 variabili: `docs/CONFIG_REFERENCE.md` (auto-generato).
> Evidenze: fan-out di verifica alla fonte `wf_28af1fee-ba0` (12 aspetti tecnici, 123 env)
> + `wf_70cfaf15-f8d` (9 assi d'uso A-I, 108 finding con file:riga).

## Uso rapido

```bash
cp presets/starter.env.example .env   # (o pro / scale / max-stealth)
# compila i campi segreti vuoti (TELEGRAM_*, PROXY_*, chiavi API...)
npm run db:migrate && npm start       # poi: bot.ps1 doctor per la diagnosi post-setup
```

I preset sono **override sopra i default di codice** (`src/config/domains.ts`) e si
compongono con `CONFIG_PROFILE` (asse AMBIENTE dev/staging/production,
`src/config/profiles.ts`): i due assi sono ortogonali — il preset è l'asse USO.
Decisione architetturale: i preset restano file `.env` (SSOT = domains.ts, zero
duplicazione di default in codice); NON sono stati aggiunti come quarto valore di
`CONFIG_PROFILE`.

## I 4 profili

| | 🟢 starter | 🔵 pro | 🟣 scale | 🟡 max-stealth |
|---|---|---|---|---|
| **Per chi** | primo bot, 1 account, PC locale | outreach B2B serio, 1 account | agenzia/power-user, 2 account, VPS | account prezioso o già "scottato" |
| **Costo/mese** | ~$50 (tutto locale) | ~$160 (SalesNav+proxy+AI) | variabile (VPS+N proxy) | proxy mobile dominante |
| **AI** | Ollama locale ($0) | hybrid: cloud no-PII + Ollama PII | hybrid (come pro) | SOLO locale |
| **Browser** | chromium headed | camoufox headless | camoufox headless | camoufox headed |
| **Proxy** | nessuno (IP casa) | residenziale sticky | residenziale per-account | mobile sticky, quality≥70 |
| **DB** | SQLite | SQLite + sync Supabase | Postgres + control plane | SQLite |
| **Inviti/sett** | 40 | 80 | 80 (somma 2 account) | 20 |
| **SalesNav** | no | sì | sì | no |

## Mappa aspetto tecnico × opzioni (12 aspetti, sintesi)

Tutte le opzioni sono env reali verificate in `src/config/` (dettaglio: CONFIG_REFERENCE.md).

| Aspetto | Env chiave | Note |
|---|---|---|
| AI testo | `AI_PROVIDER` (auto/anthropic/openai/ollama/template), `ANTHROPIC_MODEL`+`_LIGHT`, `AI_MODEL`, `AI_ALLOW_REMOTE_ENDPOINT` | guard zero-PII meccanica: i purpose PII NON vanno mai al cloud (`providerRegistry.ts:179-191`) |
| Vision/captcha | `VISION_PROVIDER`, `VISION_ALLOW_CLOUD` (default false), `VISION_BUDGET_MAX_USD`, `CHALLENGE_AUTO_RESOLVE_ENABLED` (nuova) | cloud = doppio opt-in; redaction screenshot non implementata → cloud sconsigliato |
| Proxy | `PROXY_URL/TYPE_DEFAULT/LIST`, `PROXY_EXPECTED_COUNTRIES`, `PROXY_QUALITY_*`, `IP_REPUTATION_*`, `ACCOUNT_N_PROXY_*` | failover chain + cooldown + escalation mobile già nel codice |
| Anti-ban volumi | `SOFT/HARD_INVITE_CAP`, `WEEKLY_*_LIMIT`, `PENDING_RATIO_*`, `ADAPTIVE_CAPS_*`, `COOLDOWN_*`, cap LIKE/FOLLOW/VIEW | guardrail validazione: hard>50, msg>100, weekly>200 = errore |
| Anti-ban timing | `NO_BURST_*`, `INTER_JOB_*`, `COFFEE_BREAK_*`, `CONTEXTUAL_PAUSE_*`, `SESSION_MEMORY_PROTECTION_*_MINUTES`, `GREEN_MODE_*` | tutto min/max randomizzato, mai valori fissi |
| Lifecycle | `WARMUP_*` (+ per-account), `GROWTH_*` (4 fasi), `RAMPUP_*` (curva logistica), `SSI_*` (richiede SalesNav) | growth model solo-riduce, mai aumenta |
| Targeting | `SALESNAV_SYNC_*`, CSV import, `COMPANY_ENRICHMENT_*`, scoring per lista (`scoring_criteria` DB) | filtri ICP vivono nelle saved search SalesNav, non nel codice |
| Outreach | `INVITE_WITH_NOTE`, `INVITE_NOTE_MODE` (template/ai/none), `MESSAGE_SCHEDULE_*_DELAY_HOURS`, `FOLLOW_UP_*` | tonalità AI hardcoded sales-B2B (gap, v. sotto) |
| Hosting/DB | `DB_PATH`, `DATABASE_URL`, `ALLOW_SQLITE_IN_PRODUCTION`, Docker secrets (`/run/secrets`) | NODE_ENV=production blocca SQLite senza flag esplicito |
| Sync/integrazioni | `SUPABASE_SYNC_*`, `EVENT_SYNC_SINK`, `WEBHOOK_SYNC_*` (HMAC firmato), `HUBSPOT/SALESFORCE_*` | webhook outbound = via reale per CRM; crmBridge completo ma NON wired |
| Monitoring | `TELEGRAM_*`, `DAILY_REPORT_*`, `DISCORD/SLACK_WEBHOOK_URL` (solo incident), `SENTRY_DSN`, `METRICS_AUTH_TOKEN`, SLO `OBSERVABILITY_*` | report giornaliero solo Telegram; weekly via n8n |
| Privacy/GDPR | `RETENTION_DAYS`, `GDPR_ANONYMIZE_AFTER_DAYS`/`GDPR_DELETE_AFTER_DAYS` (nuove), erasure CLI, export Art.20, redaction log | v. gap Supabase sotto |

## Assi d'uso (A-I) — cosa il codice supporta davvero

- **A. Obiettivo campagna**: il sistema è mono-obiettivo by-design (sales B2B). Campagne multiple = liste con priority/caps/scoring_criteria propri + drip campaigns (6 step type, testi custom per step via `metadata_json`). NON esiste un concetto "recruiting/networking/brand": tonalità AI inviti/messaggi hardcoded (`messagePersonalizer.ts:60-66`); solo i POST hanno tone parametrico.
- **B. Lifecycle account**: copertura forte — warmup per-account, growth 4 fasi, ramp non-lineare, trust score, cooldown, quarantena. MANCA una recovery-phase automatica post-restrizione (riattivazione solo manuale; per max-stealth è un pregio, per scale un gap).
- **C. Errori/recovery**: catena completa per captcha/sessione/ban/proxy/DOM/crash (detection → quarantena per-account → alert WHAT/WHY/DO → pausa persistita su DB). Auto-solve captcha ora disattivabile (`CHALLENGE_AUTO_RESOLVE_ENABLED=false`).
- **D. Profilo utente**: tecnico self-host ben servito (docker-compose 5 servizi, setup-vps.sh, doctor); NON-tecnico scoperto (nessun wizard di prima configurazione; dashboard opera ma non configura). Agenzia = **un deployment per cliente** (multi-tenant DB assente by-design).
- **E. Compliance**: starter/max-stealth sono GDPR-by-default (tutto locale). ⚠️ pro/scale: l'erasure NON si propaga alla copia Supabase e `public.leads` ha RLS disabilitata (`supabase.full.schema.sql:111,379`) — da fixare prima di dichiararli GDPR-compliant; opt-out blocca l'enrichment ma non l'outreach.
- **F. Lingua**: **vincolo trasversale: l'account LinkedIn deve avere la UI in EN o IT** (selettori DOM e detection weekly-limit/challenge coprono solo EN+IT). I contenuti outreach coprono 6 lingue (it/en/fr/es/de/nl, varianza ridotta su de/nl). Con proxy estero: camoufox obbligatorio (geo-coerenza automatica via geoip); il fingerprint pool può assegnare locale non coerente col proxy (gap noto).
- **G. Scala**: max 2 slot account per istanza (`env.ts:133`); isolamento per-account reale (sessione, proxy, fingerprint, quarantena, health) ma cap daily/weekly su bucket UNICO condiviso (migration 055 schema-ready, call-site non wired) e trust/risk globali. Esecuzione account SEQUENZIALE con gap 2-5min (deliberata, anti-correlazione). N>2 account = più istanze isolate.
- **H. Budget**: zero-cloud $0 è il DEFAULT del codice (Ollama-first, degradazione dichiarata fino a template); Anthropic = tripla opt-in; tier brain/light automatico. MANCA uno spend-cap USD sulle chiamate testo cloud (esiste solo `VISION_BUDGET_MAX_USD`, per-sessione).
- **I. Reporting**: Telegram out-of-the-box (alert + daily report in-loop); comandi Telegram in INGRESSO richiedono Supabase; weekly report richiede n8n; Discord/Slack wired solo sugli incident; export CSV/JSON Art.20 con audit.

## Gap per profilo (cosa manca nel codice — tracciato, non bloccante)

| Profilo | Gap | Evidenza |
|---|---|---|
| starter | wizard primo setup assente (345 env → preset mitiga) | `loopCommand.ts:1036` è wizard runtime, non setup |
| pro | erasure non propagata a Supabase + RLS off su `public.leads` | `supabase.full.schema.sql:111,379`; nessun match erasure in `src/sync` |
| pro | spend-cap USD assente per testo cloud | solo `VISION_BUDGET_MAX_USD` (`openaiVisionProvider.ts:403`) |
| pro | vision cloud senza blur (redaction = fail-fast throw) | `openaiVisionProvider.ts:425-438` (H19) |
| scale | slot account hardcoded a 2 | `parseAccountProfileFromEnv(slot: 1\|2)` `env.ts:133`, `index.ts:20-23` |
| scale | cap daily/weekly per-account non wired (bucket 'default' unico) | migration 055 pronta; call-site senza accountId (`stats.ts:708`, `inviteWorker.ts:592`) |
| scale | trust/risk condivisi tra account | `scheduler.ts:438-442` (commento esplicito) |
| scale | lead→account = modulo non persistito (migrano se cambia la lista account) | `accountManager.ts:135-147`; nessun `leads.account_id` locale |
| scale | locale browser per-account assente (timezone per-account c'è, M18) | grep locale in `accountManager.ts` = 0 |
| scale | tier cloud WARM_UP/ACTIVE/... senza transizioni automatiche | `cloud/types.ts:6`, nessuna logica di transizione |
| max-stealth | fingerprint pool: locale assegnato per hash, non filtrato per geo proxy | `fingerprint/pool.ts:289-303` |
| tutti | tonalità/obiettivo campagna non parametrici (sales-B2B hardcoded) | `messagePersonalizer.ts:60-66`, `inviteNotePersonalizer.ts:208-226` |
| tutti | enrollment campagne drip solo manuale via API | unico caller `campaigns.ts:153` |

## Combinazioni VIETATE (anti-ban by-design — mai metterle in un .env)

1. **Proxy datacenter o Tor su account attivo** — IP flaggati = ban (`PROXY_TOR_FALLBACK_ENABLED` resta false; Tor è solo fallback emergenza opt-in).
2. **Rotation proxy a metà sessione** — `PROXY_ROTATE_EVERY_*` durante una sessione attiva = teletrasporto IP. Sticky sempre.
3. **Geo-mismatch proxy ↔ locale ↔ timezone** — es. proxy DE + `BROWSER_LOCALE=it-IT` + `TIMEZONE=Europe/Rome`. Con proxy estero: camoufox (geoip auto) e tripla coerenza.
4. **`PENDING_RATIO_STOP` alzato per spingere i volumi** — la soglia 0.65 è il limite che LinkedIn flagga: solo stringere, mai allargare.
5. **`HARD_INVITE_CAP>50` / `WEEKLY_INVITE_LIMIT>200` / `HARD_MSG_CAP>100`** — oltre i limiti sicuri (la validazione li blocca/avvisa: `validation.ts:423-434`).
6. **`INVITE_NOTE_MODE=ai` + cloud ad alto volume** — testo AI generato in massa = signal di similarità; note template o nessuna nota.
7. **`AI_PROVIDER=anthropic` con `AI_ALLOW_REMOTE_ENDPOINT=false`** — config incoerente: i purpose degradano a template non-deterministici (la validazione la blocca: `validation.ts:62-69`).
8. **`VISION_ALLOW_CLOUD=true` senza budget e senza DPA** — screenshot LinkedIn = PII visiva di terzi verso cloud US; il blur non esiste ancora.
9. **Stesso proxy (o stessa `SESSION_DIR`) su 2 account** — correlazione immediata delle identità (il doctor avvisa su sessionDir duplicate: `doctor.ts:349-354`).
10. **Switch preset/profilo a caldo** — la config è init-time (account/proxy/db FROZEN in hot-reload: `hotReload.ts:38-54`): cambio preset = restart pulito, mai a metà sessione.
11. **`BYPASS_WORKING_HOURS=true` in produzione** — attività notturna implausibile = signal (è un override SOLO per testing).
12. **`CONFIG_PROFILE=dev` su account reale** — dev SPEGNE compliance, cooldown, adaptive caps, preflight (`profiles.ts:39-52`).
13. **Volumi spinti + account nuovo senza warmup** — `WARMUP_ENABLED=false` con cap alti su account giovane brucia il trust (growth model mitiga ma non sostituisce il warmup).
14. **Disattivare i gate difensivi** (`CHALLENGE_PERSISTENT_GATE=false`, `MANDATORY_PREFLIGHT_ENABLED=false`, `ADAPTIVE_CAPS_ENABLED=false`) per "andare più veloce".
15. **Più istanze bot sullo stesso account LinkedIn** — doppia sessione concorrente = pattern impossibile per un umano (1 account = 1 istanza, enforcement via lock).
16. **`INBOX_AUTO_REPLY_ENABLED=true` dal giorno 1** — auto-reply senza settimane di osservazione della qualità = rischio reputazione e signal (HITL prima).

## Implementato in questo goal (T4)

- `CHALLENGE_AUTO_RESOLVE_ENABLED` (default `true` = comportamento invariato): opt-out
  dell'auto-risoluzione captcha — `domains.ts`, `types.ts`, gate in
  `challengeHandler.ts`; max-stealth lo usa (`false`).
- `GDPR_ANONYMIZE_AFTER_DAYS` / `GDPR_DELETE_AFTER_DAYS` (default 180/365 invariati,
  floor 30/60, delete≥anonymize): soglie retention di `gdprRetentionCleanup.ts` ora
  env-driven; max-stealth usa 90/180.
- Test: `src/tests/configPresetEnvs.vitest.ts` (4 test). Quality gate: 175 file /
  1714 test, exit 0. `docs/CONFIG_REFERENCE.md` rigenerato.
