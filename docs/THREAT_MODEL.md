# Threat Model (Web/API/Plugin/Cloud & Evasion)

> Stato documento: threat model formale.
> Non sostituisce `SECURITY.md` per l'hardening operativo e non sostituisce `GUIDA_ANTI_BAN.md` per le regole pratiche.

## Scope
- **Evasion & Anti-Detection**: Cloudflare, LinkedIn bot detection, FingerprintJS.
- **Platform**: Dashboard/API (`/api/*`, SSE, session auth, control endpoints)
- **Runtime**: Worker runtime (LinkedIn automation, scheduler, queue, multi-account execution)
- **Ecosystem**: Plugin loader (`PLUGIN_DIR`, manifests, integrity checks)
- **Integrations**: Cloud integrations (Supabase/Webhook/Telegram/OpenAI)
- **Secrets**: Secrets handling (`.env`, provider keys, dashboard credentials)

## Trust Boundaries
- **Host <-> Detection Systems**: Il browser locale contro i JS iniettati da LinkedIn/Cloudflare per rilevare bot.
- **Browser <-> Dashboard API**: L'utente remoto o locale verso la dashboard.
- **Runtime process <-> Database**: Isolamento tenant e transazioni.
- **Runtime process <-> Third-party APIs**: Rate limit, autenticazione.
- **Local plugin code <-> core runtime**: Sandboxing e integrità.

## 🛡️ Evasion Threat Model (Anti-Detection)

L'attore di minaccia primario qui non è un hacker, ma **LinkedIn e i suoi provider WAF (Cloudflare)** che tentano di rilevare e bannare l'automazione.

| Minaccia | Metodo di Rilevamento | Controllo Implementato |
|----------|-----------------------|------------------------|
| **Hardware/OS Spoofing** | Discrepanze tra User-Agent e funzionalità reali (es. `navigator.platform`, `oscpu`). Font enumeration per dedurre l'OS reale. | Override coerente di `platform` e `oscpu` in base allo UA (iPhone/Android/Mac/Win). `document.fonts.check()` mockato per restituire font di sistema coerenti (NEW-5). |
| **WebGL/Canvas Fingerprinting** | Rendering identico per sessioni diverse o rendering anomalo (bot). | Pool di 12 renderer WebGL realistici. Rumore Canvas/WebGL bidirezionale via PRNG (Mulberry32) **deterministico per regione**, non piatto. |
| **Network/TLS Fingerprinting** | Il TLS handshake (JA3) rivela che stai usando Chromium (Playwright) ma lo UA dice Firefox o Safari. | **Pool Filtering**: se CycleTLS non è usato, il bot filtra Firefox/Safari e usa solo UA Chrome/Edge (coerenti con Chromium). **CycleTLS**: se attivato, esegue vero spoofing TLS. |
| **Behavioral Correlation** | L'account compie azioni con gli stessi esatti ritmi ogni giorno o senza pause umane. | **Behavioral Profiles**: Ogni account riceve un profilo di latenza unico (`profileMultiplier`). **Timing Log-Normali**: Simulate pause asimmetriche con long-tail. Dwell time post-interazione. |
| **IP Reputation/Bursts** | L'IP del proxy è in una blacklist o il bot esegue troppe azioni troppo velocemente (429). | **AbuseIPDB Pre-Check**: Gli IP blacklisted vengono scartati prima del login. **Circuit Breaker**: Chiusura immediata della sessione al primo errore Proxy. |
| **Headless/CDP Leaks** | Variabili globali iniettate da Playwright (`webdriver`, `__playwright`, stack traces CDP). | Pulizia prototipo `Error`, override `webdriver`, mock batteria e hardwareConcurrency, `isHeadless` fallback. |

## 🔒 Platform Main Threats and Controls

1. **Unauthorized dashboard/control access**  
   Control: API key/basic auth, lockout, persisted sessions, trusted IP policy, rate limits, strict CSP, security audit trail (`security_audit_events`).

2. **Session abuse/replay**  
Control: hashed session tokens, server-side revoke/rotation, expiry refresh, logout invalidation, auth-failure lockout.

3. Privilege misuse on critical operations  
Control: audit logging for pause/resume/quarantine/incident resolution and auth events; correlation IDs for traceability.

4. Plugin supply-chain / arbitrary code execution  
Control: plugin directory allowlist, manifest validation, optional SHA256 integrity, TS plugin explicit opt-in.

5. Secret leakage / stale credentials  
Control: redaction in logs, `.env.*` hardening, secret rotation inventory (`secret_inventory`), CLI checks (`secrets-status`), operator runbook.

6. Account cross-impact in multi-account runtime  
Control: account-specific queues, fairness quota per run (`ACCOUNT_MAX_JOBS_PER_RUN`), per-account health snapshots and alerts.

7. AI quality regressions (silent drift)  
Control: validation dataset + run results (`ai_validation_*`), quality snapshot metrics, A/B significance checks, false-positive intent tracking.

8. Backup/restore failure blindness  
Control: backup run tracking (`backup_runs`), checksum capture, failure alerting.

## 🧹 Process Lifecycle & Trace Cleanup

Tracce di sistema che LinkedIn NON vede direttamente, ma che possono corrompere sessioni future o lasciare artefatti rilevabili.

| Minaccia | Causa | Controllo Implementato |
|----------|-------|------------------------|
| **Zombie browser process** | Ctrl+C brusco o crash fatale lascia firefox.exe/chrome.exe nel task manager | `handleSIGINT/SIGTERM/SIGHUP: true` nelle opzioni Playwright + `cleanupBrowsers()` con wind-down organico + `performGracefulShutdown()` su uncaughtException/unhandledRejection |
| **Chiusura brusca su pagina operativa** | L'utente chiude la finestra del terminale (X) mentre il bot è su un profilo LinkedIn | Wind-down rapido in `cleanupBrowsers()`: se su pagina /sales/, /search/, /in/ → naviga al feed prima di chiudere (timeout 3s) |
| **File temporanei sessione Chromium** | La cartella `data/session/` contiene profilo Chromium vecchio (cache, .tmp, Crashpad, IndexedDB) incompatibile con Firefox | **Azione manuale**: svuotare `data/session/` prima del primo login Firefox. Il bot crea un profilo Firefox pulito al primo avvio. |
| **Job stuck in RUNNING** | Crash mid-job lascia record DB in stato RUNNING → al riavvio il bot li salta | `recoverStuckJobs()` nel graceful shutdown e nel preflight: RUNNING → PENDING |
| **Memory leak browser** | Sessioni lunghe (>30 min) accumulano memoria nel browser | `performBrowserGC()` ogni 10 job + `processMaxUptimeHours` per auto-restart pianificato |
| **Crash dump accumulo** | Crashpad/minidump files crescono nel tempo | Crashpad attualmente < 1KB. Monitorare. Firefox non usa Crashpad. |

### Procedura sicura di spegnimento
1. **Sempre Ctrl+C** — MAI chiudere la finestra del terminale
2. Attendere il messaggio `[SHUTDOWN] Database chiuso`
3. Il bot fa: wind-down organico → chiudi browser → recupera job → chiudi DB → alert Telegram "Bot Spento"

### Pulizia pre-Firefox (una tantum)
Prima del primo login con Firefox, eliminare la vecchia sessione Chromium:
```powershell
Remove-Item -Recurse -Force data\session\*
```
Firefox creerà un profilo pulito al primo `.\bot.ps1 login`.

## Residual Risks
- Browser platform changes may still cause temporary selector degradation.
- Third-party API outages can degrade features even with retries/circuit breaker.
- Local workstation compromise can bypass application-layer controls.
- **File temporanei sessione**: se il bot crasha ripetutamente, i file .tmp nella cartella Network crescono. Pulizia periodica consigliata.

## Incident Response Playbook (Severity-Based)

### Severity Matrix
| Severity | Trigger examples | Initial response target | Business impact |
|---|---|---|---|
| `SEV-1` | unauthorized control access, confirmed secret leak, data exfiltration suspicion, repeated challenge/risk stop across accounts | <= 15 minutes | Critical: automation suspended, potential trust/security impact |
| `SEV-2` | sync outage with growing backlog, repeated circuit-open on integrations, elevated run errors with partial degradation | <= 60 minutes | High: partial service disruption, delayed operations |
| `SEV-3` | isolated worker regression, single-list selector drift, non-critical plugin/runtime warning | <= 4 hours | Medium/Low: localized degradation |

### Ownership and Escalation
| Function | Primary owner | Backup owner | Responsibilities |
|---|---|---|---|
| Runtime & queue | Platform owner | Operations backup | Pause/resume, queue triage, lock contention checks |
| Integrations (Supabase/Webhook/CRM) | Integrations owner | Platform owner | Circuit/backpressure remediation, endpoint validation |
| Security/compliance | Security owner | Platform owner | Incident classification, secret rotation, evidence preservation |
| Data/privacy | Data owner | Security owner | Retention/privacy actions, report validation |

### Standard Runbook
1. Detect and classify: use `doctor`, `status`, `diagnostics`, observability API, and audit logs.
2. Contain: pause automation and quarantine affected scope (account/list/workflow) when required.
3. Eradicate root cause: fix config/runtime/dependency/integration faults; rotate secrets if relevant.
4. Recover gradually: resume in controlled mode, monitor SLO/risk/backlog, confirm stability before full throughput.
5. Post-incident: update controls/tests/docs, resolve incident records, and register remediation backlog.

### Evidence and Traceability Requirements
- Every incident must include: severity, owner, timeline, impacted components, customer impact, root cause, remediation.
- Preserve correlation IDs and relevant records (`security_audit_events`, `outbox_events`, sync logs, account health snapshots).
- Incidents are closed only after objective checks pass (`typecheck`, integration tests, operational diagnostics).

## Review Cadence
- Weekly: review security audit events and account health snapshots.
- Monthly: refresh threat model and secret inventory rotation state.
- After every incident: post-incident update of controls and this document.
- Monthly advisor run: execute `security-advisor` and track remediation backlog from generated report.
