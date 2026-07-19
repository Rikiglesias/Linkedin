# Dead code LinkedIn — findings knip (2026-06-07)

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: HEAD Linkedin=0daaf6d: src/frontend/* ESISTE (10 file), dashboard/ Next separata; package.json ancora ha chart.js:97 cycletls:101 inquirer:105 @types/inquirer:118 @types/sqlite3:121. ws (src/api/server.ts:40) + cloakbrowser (src/browser/launcher.ts:526) USATI ma grep package.json="NONE FOUND" → unlisted ancora aperto. Rimozioni dead-code (29db6c5/4d38533/e08182d) sono MAR-2026, pre-tracker → non chiudono nulla. Registrato vivo: active.md:72 (backend triage "dead-code-linkedin (4)") + maintenance…
> Azione/causa: LASCIARE APERTO. Causa (aggiungere allo Stato): "2026-07-04 verificato al source (HEAD 0daaf6d): 0/4 lotti chiusi — frontend/deps/unlisted/exports tutti intatti; rimozione tuttora RINVIATA per triage anti-ban sicuro, non inerzia." Prossimo passo concreto, in ordine di rischio crescente: (1) SAFE-SUBITO — chiudere checkbox 3: aggiungere a package.json `ws` (+devDep `@types/ws`) e `cloakbrowser` (additivo, sono usati-non-dichiarati = bug di dichiarazione, regression-safe, NON anti-ban); (2) checkbox 1 frontend: `cd Desktop/Programmi/Linkedin && npx -y knip --no-progress` per rigenerare, poi grep…


> Origine: `/goal tutto-pulito` C3. Rigenera: `cd Desktop/Programmi/Linkedin && npx -y knip --no-progress`.
> **REGOLA DI TRIAGE (non negoziabile)**: NON rimuovere a tappeto. È un bot **anti-ban di produzione**.
> Per OGNI voce, PRIMA di rimuovere: (1) usata via dynamic import / plugin system / API pubblica / reflection?
> (2) è codice ANTI-BAN/stealth (anche se "non usato ora" può essere strategia intenzionale)? (3) test E2E dopo.
> knip senza config ha MOLTI falsi positivi (non conosce entry point custom, plugin, dispatch dinamico).

## Volume (exit 0)
- **29 Unused files**: dashboard/* (6), plugins/* (2), public/* (2), scripts/* (3), `src/frontend/*` (10), `src/core/repositories/{domainIndex,leadReadOps,leadWriteOps}`, `src/integrations/crmBridge`, `src/config/featureFlags`, `src/scripts/rampUp`, `plugins/fakeActivity`.
- **132 Unused exports**: molti `src/browser/*` (anti-ban: missclick, stealth, uiFallback, selectorCanary, sessionCookieMonitor…), `src/core/repositories/*`, `src/cli/commands/salesNavCommands` (runSalesNav*), captcha, config.
- **5 Unused deps/devDeps**: `chart.js`, `cycletls`(⚠️ TLS fingerprint anti-ban — verificare!), `inquirer`, `@types/inquirer`, `@types/sqlite3`.
- **2 Unlisted deps** (usate ma non in package.json → potenziale bug, NON dead): `ws` (`api/server.ts`), `cloakbrowser` (`browser/launcher.ts`).
- **7 Unlisted binaries** = FALSI POSITIVI (powershell, pg_dump, psql, cmd.exe — binari di sistema, ok).

## Piano triage (caso-per-caso, NON a tappeto)
- [ ] **Lotto SICURO candidato**: `src/frontend/*` (10 file) — se la dashboard web è morta/sostituita → rimovibili in blocco. VERIFY prima: confermare che nessun build/serve usi frontend/, e che la dashboard attiva sia `dashboard/` (Next) non `src/frontend/`.
- [ ] **deps**: verificare `cycletls` (anti-ban TLS), `inquirer` (CLI dynamic?), `chart.js` (dashboard) — rimuovere da package.json SOLO dopo grep dynamic + run CLI.
- [ ] **Unlisted `ws`/`cloakbrowser`**: AGGIUNGERE a package.json (sono usate ma non dichiarate = bug di dichiarazione, non dead code).
- [ ] **132 exports**: triage per-modulo, MAI in blocco. Browser/anti-ban → consultare `/antiban-review` prima di toccare qualsiasi export stealth.

## Stato
- 2026-06-07: knip ESEGUITO, findings raccolti. Rimozione RINVIATA per triage sicuro (rischio anti-ban + falsi positivi + serve E2E). Questo è il motivo, non inerzia: rimuovere a tappeto su bot live = ban/rottura.
