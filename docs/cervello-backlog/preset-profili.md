# /goal preset-profili — Più possibilità d'uso per ogni aspetto (preset configurabili)

> Binding del goal (GOAL_TASK_BINDING). Creato 2026-06-11. Progetto: `C:\Users\albie\Desktop\Programmi\Linkedin`.
> Origine: richiesta utente "più possibilità per ogni tipo di uso su qualsiasi aspetto" (evoluzione del tema condivisione-esterni + costi).
> **STATO: COMPLETATO 2026-06-12** (goal lanciato dall'utente = conferma taglio 4 profili). Tutti i task `[x]` con evidenza; quality gate exit 0 (175 file / 1714 test). Doc canonico: `docs/PRESET_PROFILES.md`.

## End-state (misurabile)
4 file preset `.env` reali e commentati in `presets/` (o `docs/presets/`) — `starter`, `pro`, `scale`, `max-stealth` — ciascuno una combinazione COERENTE e ANTI-BAN-SICURA degli aspetti. + report `docs/PRESET_PROFILES.md` con: mappa aspetto×opzioni, quali env/flag ESISTONO già vs MANCANO per ogni profilo, e le opzioni mancanti implementate inline (con verifica anti-ban). VERIFY finale: ogni preset referenzia solo env REALI (grep in `config/domains.ts`), conta-problemi exit 0 se toccato `src/**`, nessuna combinazione anti-ban-pericolosa (volumi spinti + DC proxy = vietata).

## Vincolo (zero-B, dichiarato all'utente)
NON "tutte le possibilità immaginabili" (ogni flag = complessità + superficie di rischio). Solo i **4 profili sensati e sicuri** + leve fini interne. Combinazioni anti-ban-pericolose escluse by-design.

## Perimetro ESTESO (richiesta utente 2026-06-11: "ogni evenienza, ogni esigenza, ogni opzione")
I 12 aspetti TECNICI core (T1) sono solo UNA dimensione. "Ogni evenienza/esigenza" richiede anche questi ASSI d'uso (zero-L: dedotti, non citati dall'utente):
- **A. Tipo di obiettivo/campagna**: lead-gen B2B · recruiting · networking · vendita diretta · brand/visibilità → cambia volumi, messaggi, targeting.
- **B. Lifecycle account**: nuovo (warm-up) · maturo · a rischio/ristretto · in recovery post-ban → cambia volumi e cautela.
- **C. Evenienze di errore/recovery**: captcha · sessione scaduta · ban/restrizione · proxy down · LinkedIn DOM cambiato · crash → ogni preset deve dire COSA SUCCEDE.
- **D. Profilo utente**: tecnico (self-host) · non-tecnico · agenzia multi-cliente → cambia setup, default, livello automazione.
- **E. Regione/compliance**: EU (GDPR pieno) · extra-EU · settori regolati → cambia retention, consensi, zero-PII.
- **F. Lingua/localizzazione**: IT/EN/FR/DE (selettori DOM + testi messaggi).
- **G. Scala**: 1 account · pochi · agenzia (N account) → multi-tenant reale.
- **H. Budget**: zero-cloud · economico · premium (collega ai costi già analizzati).
- **I. Reporting/integrazioni**: solo Telegram · dashboard · export CSV · CRM esterno.
Ogni PROFILO è un PUNTO in questo spazio multi-asse, non solo una combinazione di flag tecnici. → T1b (sotto) mappa anche questi assi.

## RISULTATI T1 (fan-out `wf_28af1fee-ba0` DONE 2026-06-11, verificato alla fonte non a memoria)
- **123 opzioni configurabili REALI** già esistenti: AI 29 · proxy 14 · anti-ban/volumi 34 · targeting/outreach 8 · hosting/DB/scheduling 24 · monitoring/multi-account/privacy 14. Conteggio env per profilo: starter 79 · pro 90 · scale 103 · maxStealth 106.
- **SCOPERTA CHIAVE**: i 4 profili NON esistono come preset attivabili — `src/config/profiles.ts` ha solo `dev/staging/production` via NODE_ENV. I preset sarebbero override .env manuali → per veri preset serve estendere `profiles.ts` (gap T4).
- **12 GAP reali** (con file:riga): (1) profiles.ts senza i 4 preset; (2-5) multi-account "scale" non cablato bene: `pickAccountIdForLead` = hash modulo non ponderato, WEEKLY_INVITE_LIMIT globale (1 account svuota la quota), no cap cluster aggregato, no health reconciliation cross-account, no BROWSER_LOCALE per-account (geo-coerenza); (6) no PROXY_MOBILE_ONLY_MODE / PROXY_BLOCK_DATACENTER hard (solo deprioritizzazione); (7) no MESSAGE_SCHEDULE stagger per-profilo; (8) n8n cron hardcoded non env-driven; (9) Discord/Slack/Sentry in config ma NON wired (solo Telegram); (10) GDPR: no endpoint DELETE-per-user via env, no ZERO_PII_MODE per i log (solo screenshot); (11) tier light senza temperature/SALESNAV_AI_MODEL; (12) sentinella ToS — ORA ESISTE (linkedin-detection-sentinel.json, goal detection-news).
- **16 esclusioni ANTI-BAN** (combinazioni vietate by-design) salvate: es. mai anthropic+remote-off (cade su template non-det.); mai datacenter/Tor su account attivo; mai rotation mid-session; mai VISION_ALLOW_CLOUD senza redact+budget; mai geo-mismatch proxy/locale/tz; mai PENDING_RATIO_STOP alzato per spingere; mai INVITE_NOTE_MODE=ai+cloud ad alto volume (signal); mai switch profilo a caldo (config init-time → multi-profilo = multi-istanza). [Lista completa nel risultato workflow + da trasferire in docs/PRESET_PROFILES.md a T5.]

## I 4 profili (IPOTESI — confermare taglio con l'utente)
- 🟢 **starter**: AI Ollama locale, SQLite, PC locale, ricerca normale (no SalesNav), volumi conservativi, no proxy premium. ~$50/mese.
- 🔵 **pro**: AI hybrid (Opus brain + caching), SalesNav, proxy residenziale, volumi standard, Supabase, n8n. ~$160/mese.
- 🟣 **scale**: multi-account, VPS, monitoring completo, volumi dinamici per-account, sentinella attiva.
- 🟡 **max-stealth**: volumi minimi, varianza max, mobile proxy, green-mode esteso, vision locale.

## Task
- [x] **T1 — Mappa aspetto×opzioni dal codice**: fan-out `wf_28af1fee-ba0` (sessione 2026-06-11) + spot-verify alla fonte 2026-06-12 (`profiles.ts:8` solo dev/staging/production ✓; `MESSAGE_SCHEDULE_*` esistono in `domains.ts:123-124` → gap #7 chiuso dai preset; `domains.ts` letto integrale come SSOT). VERIFY: check var deterministico (vedi T3).
- [x] **T1b — Mappa ASSI d'uso A-I**: fan-out `wf_70cfaf15-f8d` (9 agenti, 108 finding, ognuno con file:riga o "assente confermato: cercato X"). Sintesi nel doc, sezione "Assi d'uso (A-I)". Vincolo trasversale scoperto: account UI solo EN/IT.
- [x] **T2 — Gap analysis per profilo**: tabella "Gap per profilo" in `docs/PRESET_PROFILES.md` — 13 gap, ognuno con evidenza file:riga (es. slot account hardcoded `env.ts:133`; cap bucket unico `stats.ts:708`; erasure non propagata `supabase.full.schema.sql:111,379`).
- [x] **T3 — 4 preset generati**: `presets/{starter,pro,scale,max-stealth}.env.example` (naming `.env.example` = convenzione template che il gate secrets già esenta; si copiano in `.env`). VERIFY eseguito 2×: 279 var totali, TUTTE esistenti in `src/config/` (script PowerShell con match anche su template-literal `ACCOUNT_${slot}_*`). Antiban-review max-stealth: SICURO.
- [x] **T4 — Opzioni mancanti implementate (inline, solo basso-rischio)**: `CHALLENGE_AUTO_RESOLVE_ENABLED` (domains/types/challengeHandler, default true; antiban-review SICURO) + `GDPR_ANONYMIZE_AFTER_DAYS`/`GDPR_DELETE_AFTER_DAYS` (gdprRetentionCleanup, default 180/365 invariati). Test: `configPresetEnvs.vitest.ts` (4 nuovi). VERIFY: `npm run conta-problemi` exit 0 (175/1714). Gap grandi NON inline → tracciati nel doc (eccezione dichiarata: multi-file/anti-ban-sensitive).
- [x] **T5 — Doc + chiusura**: `docs/PRESET_PROFILES.md` (profili, 12 aspetti, assi A-I, gap, 16 combinazioni vietate) + pointer in README + `CONFIG_REFERENCE.md` rigenerato (`npm run docs:config`) + worklog 2026-06-12 + commit.

## Leve utente
- (nessuna pendente — goal chiuso; i gap grandi sono nel doc, tabella "Gap per profilo")
