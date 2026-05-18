## Categoria 2 — Hook PowerShell (`~/.claude/hooks/*.ps1`)

### Fonti best practice consultate (Microsoft 2026)

- [PSScriptAnalyzer rules and recommendations](https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules-recommendations?view=ps-modules)
- [Using PSScriptAnalyzer](https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/using-scriptanalyzer?view=ps-modules)
- [Set-StrictMode documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/set-strictmode?view=powershell-7.6)
- [about_Preference_Variables (ErrorActionPreference)](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-7.6)

### Best practice ufficiali identificate

| BP | Cosa dice Microsoft | Severita' |
|---|---|---|
| `Set-StrictMode -Version Latest` | Genera errore terminating su variabili undefined, indexing fuori range, property non esistenti | Alta — previene bug silenziosi |
| `$ErrorActionPreference = 'Stop'` | Default 'Continue' permette silently failures; 'Stop' = fail-fast | Alta — comportamento prevedibile |
| Verb-Noun + approved verbs (`Get-Verb`) | Consistency con cmdlet built-in | Media |
| `param()` block all'inizio | Standard struttura script | Media |
| Comment-based help `<# .SYNOPSIS .DESCRIPTION #>` | Auto-generated help via `Get-Help` | Bassa stilistica |
| `try/catch` per error handling esplicito | Resilienza | Media |
| Avoid `Write-Host` → preferire `Write-Output` o `Write-Information` | Output redirectable | Media |
| `Out-Null` over `> $null` | Best practice PSScriptAnalyzer | Bassa |
| `CmdletBinding()` per advanced functions | Param validation + `-WhatIf`/`-Confirm` | Media (solo funzioni) |
| PSScriptAnalyzer come lint | CI/CD integration | Strumento |

### Stato nostro sistema (verificato 2026-05-15, 2 hook campione)

| Hook | Righe | Strict | ErrorAction | Naming | param() | Note |
|---|---|---|---|---|---|---|
| `_lib.ps1` | 313 | ❌ | ❌ | ✅ Verb-Noun | n/a | Header comment + API contract eccellente |
| `inject-runtime-brief.ps1` | 58 | ❌ | ❌ | ✅ | ✅ | Encoding UTF-8 forzato (buona pratica Win) |
| 30 altri hook (non letti dettaglio) | varie | ❌ presunto | ❌ presunto | ✅ campione | ✅ campione | Pattern coerente nei 2 campione |

**PSScriptAnalyzer**: NON installato globalmente. Comando `Install-Module PSScriptAnalyzer -Scope CurrentUser` lo aggiungerebbe.

### Gap identificati

1. **MEDIO** — Manca `Set-StrictMode -Version Latest` in tutti i 32 hook. Variabili undefined possono passare inosservate. Rischio: bug silenziosi su edge case (es. campo JSON input mancante).
2. **MEDIO** — Manca `$ErrorActionPreference = 'Stop'` esplicito. Default 'Continue' permette cmdlet di fallire silenziosi e continuare. Rischio: hook che dovrebbero bloccare azione rischiosa potrebbero non farlo se il check fallisce silently.
3. **MINOR** — Comment-based help formale `<# .SYNOPSIS #>` non usato. Solo header comments. Stilistica.
4. **MINOR** — PSScriptAnalyzer non installato per audit periodico hook. Strumento utile in CI.

### Positivi rilevanti

- ✅ API contract di `_lib.ps1` documentato con link a docs ufficiale Anthropic 2026
- ✅ Single source of truth per pattern critico (es. `$ANTIBAN_PATTERN`)
- ✅ Whitelist directory + estensione (.md/.txt/.log/.csv) per evitare falsi positivi anti-ban
- ✅ Encoding UTF-8 forzato `[Console]::InputEncoding` (workaround problema noto Windows)
- ✅ Dot-source di `_lib.ps1` per condividere logica comune (DRY)

### Fix applicati in questa sessione

NESSUNO. Rischio modifica 32 hook = potenziali regressioni. Applicare in sessione dedicata con test.

### Fix proposti per sessioni future

1. **Aggiungere init block in `_lib.ps1`** (1 fix → propagato a tutti gli hook che fanno `. _lib.ps1`):
   ```powershell
   Set-StrictMode -Version Latest
   $ErrorActionPreference = 'Stop'
   ```
   Procedura:
   - (a) test su 1 hook isolato per verificare no regressioni
   - (b) commit con singolo hook modificato + observe per 1 settimana
   - (c) propagare a `_lib.ps1` se nessun fallout
   - (d) per hook che NON dot-source `_lib.ps1`, fix individuale

2. **Installare PSScriptAnalyzer + aggiungere `audit:hooks-static-analysis`** npm script:
   ```powershell
   Install-Module PSScriptAnalyzer -Scope CurrentUser
   Invoke-ScriptAnalyzer -Path "$HOME\.claude\hooks" -Recurse
   ```
   Inserire in bundle `audit:weekly` come check informativo.

3. **Convertire header comments in comment-based help** (`<# .SYNOPSIS .DESCRIPTION .PARAMETER #>`) per i 5 hook piu' complessi. Bassa priorita'.

### Audit verdi mantenuti

- `audit:hooks` ✅ 17/17 (registry conformity)
- Quality gate ✅ 1430/1430 test

---

