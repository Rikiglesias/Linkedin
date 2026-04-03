# Scripts

Questa cartella non contiene solo script dello stesso tipo. Per evitare confusione, i file vanno letti cosi':

## Script canonici di progetto

- [buildFrontend.ts](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/buildFrontend.ts)  
  Build frontend canonico usato da `npm run build:frontend`.
- [generate-config-docs.mjs](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/generate-config-docs.mjs)  
  Genera [CONFIG_REFERENCE.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/CONFIG_REFERENCE.md).
- [migrate-to-postgres.ts](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/migrate-to-postgres.ts)  
  Migrazione SQLite -> PostgreSQL usata da `npm run db:migrate`.

## Script manuali / operativi

- [startCycleTls.ts](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/startCycleTls.ts)  
  Utility manuale per proxy JA3/CycleTLS. Non fa parte del runtime normale del bot.
- [setup-vps.sh](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/setup-vps.sh)  
  Helper manuale per setup VPS.

## Script sidecar / ad-hoc

- [morning-briefing.js](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/morning-briefing.js)  
  Utility personale/esterna per briefing Slack. Non e' agganciata al runtime principale del progetto.
- [testEnrichment.ts](/C:/Users/albie/Desktop/Programmi/Linkedin/scripts/testEnrichment.ts)  
  Script manuale di test enrichment, non comando canonico del progetto.

## Regola

- Se uno script viene richiamato da `package.json`, documentazione operativa o workflow runtime, e' canonico.
- Se e' solo una utility manuale o ad-hoc, non va confuso con il perimetro core del progetto.
- Prima di aggiungere nuovi script, chiedersi se devono stare qui, in `src/scripts/`, o fuori dal repo principale.
