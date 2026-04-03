# LinkedIn Bot

Piattaforma di automazione LinkedIn con motore browser stealth, risk engine, workflow orchestrati e dashboard locale.

Questo file e' volutamente corto: serve come punto di ingresso tecnico. Le regole operative, i backlog e le guide specialistiche vivono nei documenti dedicati.

## Prima di toccare il repo

Leggi in quest'ordine:

1. [AGENTS.md](AGENTS.md)  
   Regole operative canoniche del progetto.
2. [docs/README.md](docs/README.md)  
   Indice della documentazione e ruolo di ogni file.
3. [docs/AI_OPERATING_MODEL.md](docs/AI_OPERATING_MODEL.md)  
   Roadmap su modelli, skill, workflow, n8n e automazioni.
4. [todos/active.md](todos/active.md)  
   Priorita' correnti.
5. [todos/workflow-architecture-hardening.md](todos/workflow-architecture-hardening.md)  
   Backlog tecnico operativo.
6. [docs/tracking/ENGINEERING_WORKLOG.md](docs/tracking/ENGINEERING_WORKLOG.md)  
   Verifiche e interventi tecnici realmente eseguiti.

## Mappa rapida dei documenti

- [docs/GUIDA.md](docs/GUIDA.md)  
  Guida operativa passo-passo per usare il bot.
- [docs/GUIDA_ANTI_BAN.md](docs/GUIDA_ANTI_BAN.md)  
  Regole operative anti-ban per l'operatore.
- [docs/ARCHITECTURE_ANTIBAN_GUIDE.md](docs/ARCHITECTURE_ANTIBAN_GUIDE.md)  
  Reference tecnica anti-ban e stealth.
- [docs/SECURITY.md](docs/SECURITY.md)  
  Hardening, privacy, incident response e routine di sicurezza.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)  
  Threat model formale.
- [docs/WORKFLOW_ENGINE.md](docs/WORKFLOW_ENGINE.md)  
  Contratto canonico del motore workflow.
- [docs/WORKFLOW_MAP.md](docs/WORKFLOW_MAP.md)  
  Vista utente/operatore dei workflow.
- [docs/WORKFLOW_ANALYSIS.md](docs/WORKFLOW_ANALYSIS.md)  
  Analisi tecnica approfondita, non guida operativa.
- [docs/CONFIG_REFERENCE.md](docs/CONFIG_REFERENCE.md)  
  Reference tecnica della configurazione.
- [docs/CONFIG_EXAMPLES.md](docs/CONFIG_EXAMPLES.md)  
  Configurazioni d'esempio.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)  
  Integrazioni esterne, webhook e n8n.

## Avvio essenziale

### Setup locale

```bash
npm install
copy .env.example .env
npm run build
```

### Verifica minima

```bash
npm run dashboard:dev
npm run start:dev -- doctor
```

### Esecuzione

```bash
npm run start:dev -- run-loop
```

Se preferisci il wrapper PowerShell, usa [bot.ps1](bot.ps1), che ricompila automaticamente quando il `dist/` e' stantio.

## Comandi utili

- `npm run build`  
  Build backend + frontend.
- `npm run typecheck`  
  Verifica tipi.
- `npm run lint`  
  Lint a tolleranza zero.
- `npm run conta-problemi`  
  Quality gate completo del progetto.
- `npm run dashboard:dev`  
  Dashboard locale.
- `npm run start:dev -- doctor`  
  Diagnostica operativa.
- `npm run start:dev -- run-loop`  
  Avvio loop runtime.

## Struttura ad alto livello

```text
src/                runtime, workflow, browser, AI, API
public/             asset frontend buildati
docs/               documentazione tecnica e operativa
docs/tracking/      verifiche e worklog reali
todos/              backlog vivo
n8n/                note operative sui workflow n8n
n8n-workflows/      template/import workflow
dashboard/          dashboard dedicata
plugins/            plugin SDK minimale
scripts/            script canonici, manuali e sidecar
data/               runtime data, DB, sessioni, backup locali
```

Nota: `dashboard/` e' un sotto-progetto separato per task/TODO su Supabase, non la control room principale del bot. La dashboard runtime principale e' quella servita dal backend e renderizzata da `public/index.html` + `public/assets/bundle.js`.

## Regola documentale

- `README.md` = overview e access point.
- `AGENTS.md` = regole operative.
- `todos/*.md` = backlog vivo.
- `docs/tracking/*` = storico tecnico verificato.
- `docs/archive/*` = materiale storico o declassato che non deve guidare il lavoro corrente.

## Nota su `TODO.md`

Il vecchio audit monolitico non e' piu' il backlog operativo primario.

- [TODO.md](TODO.md) resta solo come puntatore corto.
- L'archivio completo e' in [docs/archive/todo-audit-archive-2026-04-03.md](docs/archive/todo-audit-archive-2026-04-03.md).

## Root hygiene

Non trattare la root come deposito generico.

- `src/`, `docs/`, `todos/`, `n8n/`, `n8n-workflows/`, `dashboard/`, `plugins/` hanno ruoli chiari.
- Artefatti come `dist/`, `coverage/`, `logs/` e `data/` non vanno promossi a documentazione o backlog.
- Cartelle tool-managed come `.agents`, `.claude`, `.windsurf` non vanno pulite alla cieca.
