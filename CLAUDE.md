# CLAUDE.md — Policy operativa per Claude Code (LinkedIn Bot)

> Regole specifiche per questo progetto. Le regole globali (skill, Agent Teams, metodologia, comunicazione) sono in `~/.claude/CLAUDE.md` e si applicano automaticamente.

---

# Skill specifiche di questo progetto

In aggiunta alla tabella globale, per questo progetto:

| Tipo di task | Skill / Tool da invocare |
|-------------|--------------------------|
| Messaggi LinkedIn, outreach B2B | `/cold-email`, `/copywriting`, `/marketing-psychology` |
| Anti-ban review (OBBLIGATORIO prima di ogni modifica bot) | Agent `antiban-review` — invocare con `Agent { subagent_type: "antiban-review" }` |
| Stato produzione / deploy readiness | `/deploy-check` |
| Report lead / analytics LinkedIn | Agent `lead-analyst` — invocare con `Agent { subagent_type: "lead-analyst" }` |
| Debug errori / crash bot | Agent `linkedin-log-debugger` — invocare con `Agent { subagent_type: "linkedin-log-debugger" }` |
| Audit task aperti | `/audit` |
| Creare / modificare workflow n8n | Agent `n8n-builder` + MCP n8n (`mcp__n8n-mcp__*`) |
| Debug visivo browser / DOM LinkedIn | Playwright MCP (`browser_navigate`, `browser_snapshot`, `browser_take_screenshot`) |
| Security scan mirato su modifica auth/stealth | Semgrep MCP (`semgrep_scan`) |

---

# Quality assurance — zero tolleranza

- **Prima di modificare:** `npm run pre-modifiche` — **blocco** se errori, warning o test falliti.
- **Dopo le modifiche:** `npm run post-modifiche` — **blocco** se restano problemi.
- **Prima del commit:** `npm run conta-problemi` = **zero problemi** (TypeScript + ESLint + Vitest, come in `package.json`).
- Exit code ≠ 0 → **non procedere** come se fosse ok.
- `npm run helper-manuali` è un **promemoria** nello script: le verifiche manuali vanno fatte davvero, non si assume che il comando le sostituisca.
- **Flusso:** pre-modifiche → correzioni → sviluppo → post-modifiche → commit.

---

## PRIORITÀ ASSOLUTA: ANTI-BAN E ANTI-DETECT

Ogni modifica alla codebase DEVE essere valutata PRIMA DI TUTTO dal punto di vista anti-ban. La domanda zero è sempre: "Questa modifica può farci bannare o rilevare da LinkedIn?"

### Prima di scrivere codice, chiedersi:
1. Cambia comportamento browser su LinkedIn? → varianza garantita, niente pattern fissi
2. Cambia timing / delay / ordine azioni? → jitter preservato
3. Tocca fingerprint, stealth, cookie, session? → coerenza e test regressione
4. Aggiunge azione su LinkedIn (click, navigazione, typing)? → humanDelay obbligatorio
5. Cambia volumi (budget, cap, limiti)? → pending ratio non deve salire oltre 65%

### Principi anti-ban non negoziabili
- **VARIANZA SU TUTTO**: un umano reale non fa mai la stessa cosa allo stesso modo. Login a orari diversi (jitter 0-30min), budget diverso ogni giorno (mood factor ±20%), ratio invite/message variabile (±15%), ordine job shufflato (±60s), typing speed variabile per lunghezza testo
- **SESSIONI CORTE**: 2 sessioni da ~25 min è meglio di 1 da ~50 min. Max delay 180s tra job. Pausa pranzo 2h. Weekend zero attività
- **PENDING RATIO SOTTO CONTROLLO**: è il KPI #1. Se supera 65% → red flag LinkedIn. Ritirare inviti dopo 21 giorni, targeting per score (lead migliori prima), warm-touch pre-invito (+30-50% acceptance)
- **FINGERPRINT COERENTE**: deterministico per account+settimana (FNV-1a), canvas noise PRNG Mulberry32, WebGL pool 12 valori realistici. 19 mock stealth. Test regressione (16+14 test). MAI fake cookies GA/Facebook, MAI doppia patch stessa API, MAI pattern fissi nel noise
- **AZIONI SICURE**: confidence check pre-click (verifica testo bottone), post-action verify (modale apparso?), cap challenge 3/giorno, blacklist check runtime in TUTTI i worker, cookie anomaly detection, circuit breaker dopo N fallimenti
- **NAVIGAZIONE UMANA**: organic visit 20% recent-activity prima di Connect, warmup sessione (feed/notifiche/search), humanDelay realistici, humanType con velocità variabile, humanMouseMove naturale, humanWindDown variato
- **MONITORING ATTIVO**: probe LinkedIn prima di ogni batch, inbox scan per keywords ban ("unusual activity", "restricted"), daily report Telegram con pending ratio + risk score, alert immediato per cookie anomaly e hot lead

---

## WORKFLOW OBBLIGATORIO PER QUESTO PROGETTO

### Classifica il task prima di tutto

| Tipo | Quando | Passi |
|------|--------|-------|
| **Quick fix** | <30min, non tocca browser/timing/stealth | 1 → 4 → 5 → 6 |
| **Bug bot** | crash, errore runtime | Agent `linkedin-log-debugger` → 1 → 4 → 5 → 6 |
| **Feature / modifica bot** | tocca browser, timing, delay, stealth, volumi | 1 → 2 → 3 → 4 → 5 → 6 |
| **Refactor / infra** | DB, log, config — non tocca browser | 1 → 3 → 4 → 5 → 6 *(no anti-ban)* |

### Passi

**1. Pre-modifica** *(sempre)*
`npm run pre-modifiche` — blocco se errori, warning o test falliti.

**2. Anti-ban + security** *(solo se tocca browser / timing / delay / stealth / volumi / fingerprint / cookie)*
- `Agent { subagent_type: "antiban-review" }`
- Se tocca anche auth / input utente / query DB → `mcp__plugin_semgrep-plugin_semgrep__semgrep_scan`

**3. Planning** *(solo feature >1h o decisioni architetturali)*
- Se approccio non ovvio → `superpowers:brainstorming`
- Poi Plan Mode per lista step approvata
- Per ogni passo del piano completato → `superpowers:code-reviewer` (Agent)

**4. Implementa**
Usa la skill di dominio dalla tabella sopra.

**5. Verifica** *(sempre)*
`npm run conta-problemi` — exit code 0 obbligatorio. Poi L1-L6 globali + estensioni LinkedIn.

**6. Commit + push** *(dopo ogni unità atomica verificata)*
- Task complesso: `superpowers:verification-before-completion` prima del commit
- `/git-commit`
- Feature branch → `superpowers:finishing-a-development-branch` → `/git-create-pr`

## Estensioni LinkedIn ai livelli globali

**L1 aggiuntivo:** `npm run build` se modifica frontend. `npx madge --circular` se tocchi moduli core — deve restare a 0. Coverage su risk, scheduler, auth, stealth.

**L3 aggiuntivo:** Per browser: memory leak closure? Listener rimossi? Timeout propagato? Per stealth: PRNG uniforme? Pattern rilevabile? busy_timeout sul DB?

**L4 aggiuntivo:** Scenari LinkedIn: multi-giorno (Set cresce?), recovery (DB corrotto?), pause durante invito, aggiornamento selettori LinkedIn.

**L5 aggiuntivo:** Telegram con istruzioni chiare, daily report con pending ratio + risk score.

**L6 aggiuntivo:** migration→repository→API→frontend→report: dato arriva fino all'utente?

## REGOLA D'ORO
Anti-ban viene PRIMA di tutto. I livelli si applicano per contesto — solo i punti rilevanti. Ma i BASE vanno sempre verificati.
