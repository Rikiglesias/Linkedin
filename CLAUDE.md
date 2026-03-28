# CLAUDE.md — Policy operativa per Claude Code (LinkedIn Bot)

> Regole specifiche per questo progetto. Le regole globali (skill, Agent Teams, metodologia, comunicazione) sono in `~/.claude/CLAUDE.md` e si applicano automaticamente.

---

# Skill specifiche di questo progetto

In aggiunta alla tabella globale, per questo progetto:

| Tipo di task | Skill da invocare |
|-------------|------------------|
| Messaggi LinkedIn, outreach B2B | `/cold-email`, `/copywriting`, `/marketing-psychology` |
| Anti-ban review (modifica bot) | `/antiban-review` |
| Stato produzione / deploy | `/deploy-check` |
| Report lead LinkedIn | `/lead-report` |
| Audit task aperti | `/audit` |

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
1. Questa modifica cambia il comportamento del browser su LinkedIn? Se sì → massima attenzione
2. Questa modifica cambia timing, delay, ordine delle azioni? Se sì → verificare che la varianza resti
3. Questa modifica tocca fingerprint, stealth, cookie, session? Se sì → verificare coerenza e test
4. Questa modifica aggiunge un'azione nuova su LinkedIn (click, navigazione, typing)? Se sì → deve sembrare umana
5. Questa modifica cambia volumi (budget, cap, limiti)? Se sì → verificare che il pending ratio non salga

### Principi anti-ban non negoziabili
- **VARIANZA SU TUTTO**: un umano reale non fa mai la stessa cosa allo stesso modo. Login a orari diversi (jitter 0-30min), budget diverso ogni giorno (mood factor ±20%), ratio invite/message variabile (±15%), ordine job shufflato (±60s), typing speed variabile per lunghezza testo
- **SESSIONI CORTE**: 2 sessioni da ~25 min è meglio di 1 da ~50 min. Max delay 180s tra job. Pausa pranzo 2h. Weekend zero attività
- **PENDING RATIO SOTTO CONTROLLO**: è il KPI #1. Se supera 65% → red flag LinkedIn. Ritirare inviti dopo 21 giorni, targeting per score (lead migliori prima), warm-touch pre-invito (+30-50% acceptance)
- **FINGERPRINT COERENTE**: deterministico per account+settimana (FNV-1a), canvas noise PRNG Mulberry32, WebGL pool 12 valori realistici. 19 mock stealth. Test regressione (16+14 test). MAI fake cookies GA/Facebook, MAI doppia patch stessa API, MAI pattern fissi nel noise
- **AZIONI SICURE**: confidence check pre-click (verifica testo bottone), post-action verify (modale apparso?), cap challenge 3/giorno, blacklist check runtime in TUTTI i worker, cookie anomaly detection, circuit breaker dopo N fallimenti
- **NAVIGAZIONE UMANA**: organic visit 20% recent-activity prima di Connect, warmup sessione (feed/notifiche/search), humanDelay realistici, humanType con velocità variabile, humanMouseMove naturale, humanWindDown variato
- **MONITORING ATTIVO**: probe LinkedIn prima di ogni batch, inbox scan per keywords ban ("unusual activity", "restricted"), daily report Telegram con pending ratio + risk score, alert immediato per cookie anomaly e hot lead

### Cosa NON fare MAI
- Inviare inviti senza varianza nei tempi
- Fare login alla stessa ora ogni giorno
- Tenere il browser aperto più di 45 minuti di fila
- Risolvere più di 3 challenge automaticamente in un giorno
- Ignorare un pending ratio > 65%
- Usare fake localStorage cookies (GA, Facebook Pixel)
- Fare doppia patch sulla stessa Web API
- Navigare con pattern fissi prevedibili
- Digitare alla stessa velocità su testi di lunghezze diverse
- Aggiungere azioni su LinkedIn senza humanDelay

---

## WORKFLOW OBBLIGATORIO PER QUESTO PROGETTO
1. `npm run pre-modifiche` PRIMA di iniziare
2. Valutare impatto anti-ban (priorità #0)
3. Implementare la modifica
4. `npm run conta-problemi` DOPO — exit code 0 obbligatorio
5. Verifica L1-L6 globali + estensioni LinkedIn sotto
6. Commit con messaggio dettagliato

## Estensioni LinkedIn ai livelli globali

**L1 aggiuntivo:** `npm run build` se modifica frontend. `npx madge --circular` se tocchi moduli core — deve restare a 0. Coverage su risk, scheduler, auth, stealth.

**L3 aggiuntivo:** Per browser: memory leak closure? Listener rimossi? Timeout propagato? Per stealth: PRNG uniforme? Pattern rilevabile? busy_timeout sul DB?

**L4 aggiuntivo:** Scenari LinkedIn: multi-giorno (Set cresce?), recovery (DB corrotto?), pause durante invito, aggiornamento selettori LinkedIn.

**L5 aggiuntivo:** Telegram con istruzioni chiare, daily report con pending ratio + risk score.

**L6 aggiuntivo:** migration→repository→API→frontend→report: dato arriva fino all'utente?

## REGOLA D'ORO
Anti-ban viene PRIMA di tutto. I livelli si applicano per contesto — solo i punti rilevanti. Ma i BASE vanno sempre verificati.
