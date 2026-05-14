# AI Audit Cadences

> Cadenze operative per audit periodici del sistema AI. Aggiornato 2026-05-14.

## Bundle audit

| Bundle | Quando | Cosa esegue | Tempo medio |
|---|---|---|---|
| `npm run audit:weekly` | Settimanale (lunedì mattina) | miss-metrics + handoff-staleness + violations | ~30s |
| `npm run audit:monthly` | Mensile (primo del mese) | ai-control-plane + adk-capabilities + rule-enforcement + ledger + skills | ~60s |

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
- Output `audit:handoff-staleness`: se 4/6 o meno, rigenerare `SESSION_PROMPT.md` con `/session-prompt`.
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

## Stato corrente (aggiornato 2026-05-14)

- Bundle script: presenti in `package.json` (`audit:weekly`, `audit:monthly`).
- **Wrapper .bat creati**: `scripts/run-audit-weekly.bat`, `scripts/run-audit-monthly.bat` (output in `%USERPROFILE%\memory\audit-{weekly,monthly}-YYYYMMDD.log`).
- **Task Scheduler registrato**:
  - `LinkedIn-AI-Audit-Weekly` — prima esecuzione lun 18/05/2026 09:00, ogni lunedì
  - `LinkedIn-AI-Audit-Monthly` — prima esecuzione 01/06/2026 09:00, ogni primo del mese
- Last run: nessuna ancora — attende prima trigger automatica.
- Verifica manuale: `schtasks /Query /TN "LinkedIn-AI-Audit-Weekly"` o `Get-ScheduledTask -TaskName "LinkedIn-AI-Audit-*"`.

## Fonti di verità

- `package.json` (scripts npm)
- `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` item 11 (orizzonti temporali)
- `~/.claude/hooks/session-start.ps1` (se Opzione 3)
