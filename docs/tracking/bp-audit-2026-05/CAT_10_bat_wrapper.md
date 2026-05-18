## Categoria 10 — Bat wrapper (`scripts/run-audit-*.bat`)

### Fonti best practice consultate (Microsoft 2026)

- [Microsoft Learn: `setlocal`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setlocal)
- [Microsoft Learn: `exit`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/exit)

### Best practice identificate

`setlocal` isola l'ambiente; dopo `call` va preservato `%ERRORLEVEL%`; `exit /b <exitcode>` propaga il codice uscita al Task Scheduler.

### Stato nostro sistema

| File | Problema rilevato | Fix |
|---|---|---|
| `scripts/run-audit-weekly.bat` | Non propagava exit code di `npm run audit:weekly` | ✅ cattura `%ERRORLEVEL%`, logga exit code, `exit /b` |
| `scripts/run-audit-monthly.bat` | Non propagava exit code di `npm run audit:monthly` | ✅ cattura `%ERRORLEVEL%`, logga exit code, `exit /b` |

### Gap residui

| # | Gap | Severity | Note |
|---|---|---|---|
| 1 | Path repo hardcoded | LOW | accettabile su macchina personale; per ADK distribuito usare env var |

### Fix applicati in questo turno

- ✅ Entrambi i wrapper ora terminano con lo stesso exit code dell'audit npm.
- ✅ Il log contiene `Exit code: N` prima di `=== END ===`.
- ✅ `DATESTAMP` ora usa `Get-Date -Format yyyyMMdd`, non substring locale-sensitive di `%date%`.

---

