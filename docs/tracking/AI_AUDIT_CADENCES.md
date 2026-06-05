# AI Audit Cadences

> Cadenze operative per audit periodici del sistema AI. Aggiornato 2026-05-14.

## Bundle audit

| Bundle | Quando | Copre (domini) | Cosa esegue |
|---|---|---|---|
| `npm run audit:daily` | Ogni giorno | sicurezza + qualità + backend/frontend | security:scan (secret) + conta-problemi (typecheck BE+FE + lint + test) |
| `npm run audit:weekly` | Settimanale (lun) | AI-meta: drift/log/handoff | miss-metrics + handoff-staleness + continuation + violations + memory-staleness + docs-size + obsidian-vault + output-styles + mcp-config + json-schemas + rules-coverage + skill-filenames + auto-track |
| `npm run audit:biweekly` | Ogni 2 settimane | + architettura + build E2E | audit:weekly + `madge --circular src/` + build (backend+frontend) |
| `npm run audit:monthly` | Mensile (1° del mese) | AI-meta: salute control plane | ai-control-plane + adk-capabilities + rule-enforcement + ledger + skills |
| `npm run audit:quarterly` | Ogni 4 settimane | profondo: sicurezza + architettura + build | audit:monthly + security:scan + build + `madge --circular src/` |

> Copertura end-to-end: **sicurezza** (security:scan secret in daily/quarterly; SAST semgrep MCP/`/security-reviewer` = manuale periodico), **qualità** (typecheck+lint+test in daily), **architettura** (madge circular in biweekly/quarterly), **backend+frontend** (typecheck:backend + typecheck:frontend + build in daily/biweekly/quarterly), **AI control plane** (weekly/monthly).

Esecuzione singola degli audit possibile via npm script dedicato (vedi `package.json` sezione `scripts`).

## Schedulazione su Windows

Gli audit sono locali (leggono `~/memory/*-log.txt`, file repo, `~/.claude/settings.json`) — non si schedulano via `/schedule` Anthropic remoto.

### Opzione 1: Windows Task Scheduler (consigliato)

1. Aprire Task Scheduler (taskschd.msc)
2. Creare task `LinkedIn-AI-Audit-Weekly`:
   - Trigger: settimanale, lunedì 09:00
   - Azione: `cmd /c "cd C:\Users\albie\Desktop\Programmi\Linkedin && npm run audit:weekly > %USERPROFILE%\memory\audit-weekly-%date:~10,4%%date:~4,2%%date:~7,2%.log 2>&1"`
3. Creare task `LinkedIn-AI-Audit-Monthly`:
   - Trigger: primo del mese alle 09:00
   - Azione: `cmd /c "cd C:\Users\albie\Desktop\Programmi\Linkedin && npm run audit:monthly > %USERPROFILE%\memory\audit-monthly-%date:~10,4%%date:~4,2%%date:~7,2%.log 2>&1"`

### Opzione 2: Trigger manuale alla mattina

Aggiungere alias bash in `~/.bashrc` / `~/.profile`:
```bash
alias audit-week='cd /c/Users/albie/Desktop/Programmi/Linkedin && npm run audit:weekly'
alias audit-month='cd /c/Users/albie/Desktop/Programmi/Linkedin && npm run audit:monthly'
```

Eseguire al primo terminal della giornata (lunedì / primo del mese).

### Opzione 3: Hook SessionStart-based

Modificare `~/.claude/hooks/session-start.ps1` per controllare last-run timestamp e suggerire l'audit appropriato al modello come reminder se scaduto. Pro: zero schedulazione esterna. Contro: parte solo se Riccardo apre Claude Code.

## Cosa rivedere a ogni cadenza

### Weekly review (5 min)
- Output `audit:miss-metrics`: ci sono candidate forti per promozione blocking (miss veri sopra soglia)? Se sì, valutare promozione.
- Output `audit:handoff-staleness`: se fallisce, aggiornare `.claude/CONTINUATION.md`, memoria/todos se serve, poi eseguire sync Obsidian; usare `/session-prompt` solo come fallback legacy richiesto.
- Output `audit:violations`: pattern di warning ricorrenti (worklog non aggiornato, hard blocks)?

### Monthly review (15 min)
- `audit:ai-control-plane`: tutti 25/25 verdi.
- `audit:adk-capabilities`: candidate esterne (Caveman, LeanCTX, SIMDex, Contact Skills) ancora "evaluate-before-install" o pronte per scelta?
- `audit:rule-enforcement`: gap meccanizzabili apparsi?
- `audit:ledger`: copertura ledger ancora completa?
- `audit:skills`: skill critiche ancora attivabili (no manifest rotti dopo update marketplace)?

## Quando aggiungere nuovi audit ai bundle

- Weekly: audit con metriche che cambiano spesso (miss, drift, log analysis).
- Monthly: audit di salute architetturale (registry, governance, schema).
- Mai aggiungere audit che richiedono input utente — solo audit programmatici idempotenti.

## Stato corrente (aggiornato 2026-06-05)

- Bundle script: presenti in `package.json` (tutti e 5: `audit:daily/weekly/biweekly/monthly/quarterly`).
- **Task Scheduler — 5 cadenze REGISTRATE e funzionanti** (2026-06-05, fix finding 4B-1/4B-2):
  | Task | Cadenza | Bundle |
  |---|---|---|
  | `LinkedIn-AI-Audit-Daily` | ogni giorno 09:00 | `audit:daily` (security:scan + 1430 test) |
  | `LinkedIn-AI-Audit-Weekly` | lunedì 09:00 | `audit:weekly` (AI-meta drift/log) |
  | `LinkedIn-AI-Audit-Biweekly` | lun ogni 2 sett. 09:00 | `audit:biweekly` (+ madge + build) |
  | `LinkedIn-AI-Audit-Monthly` | 1° del mese 09:00 | `audit:monthly` (control-plane) |
  | `LinkedIn-AI-Audit-Quarterly` | lun ogni 4 sett. 09:00 | `audit:quarterly` (security + build profondo) |
- **Fix 4B-1 applicato** (era: Weekly/Monthly fallivano con HRESULT 0x800710E0): tutti i task ora hanno `DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false`, `StartWhenAvailable=true` (recupera i run mancati). Verificato: `/Run` Daily → State=Running, LastResult=0x41301 (running, NON più 0x800710E0 respinto).
- **LogonType=InteractiveToken** (registrati via `schtasks /Create /XML`, senza admin): i task partono quando l'utente è loggato (PC personale, quasi sempre) + `StartWhenAvailable` recupera al login i run saltati.
- **Opzionale — S4U "run whether logged on or not"**: richiede PowerShell **admin** (`Set-ScheduledTask -Principal (New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U)`). Non applicato (il mio shell non è elevato); da eseguire manualmente se serve esecuzione da sloggato. Leva utente.
- `audit:daily` validato 2026-06-04 (security:scan + 1430 test verdi). `biweekly`/`quarterly` eseguono `npx madge` (scarica madge al primo run).
- ⚠️ **Collegato — finding 6-2/6-3 (cascata `&&` fragile)**: quando i task girano, le cascate `audit:weekly`/`monthly`/`biweekly`/`quarterly` possono abortire all'80% se una sub-audit di stato (handoff-staleness/obsidian-vault) fallisce. Fix cascata (runner ts no-`&&` + hard-fail vs soft-state) = prossimo blocco prima che lo scheduling dia copertura piena.
- Verifica manuale: `Get-ScheduledTask -TaskName "LinkedIn-AI-Audit-*"` o `schtasks /Query /TN "LinkedIn-AI-Audit-Daily" /XML`.

## Fonti di verità

- `package.json` (scripts npm)
- `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` item 11 (orizzonti temporali)
- `~/.claude/hooks/session-start.ps1` (se Opzione 3)
