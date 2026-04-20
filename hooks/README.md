# Claude Code Hooks — LinkedIn Bot Project

Questo file documenta gli hook attivi, il loro ruolo e come installarli.

## Installazione (setup macchina)

Gli hook sono file PowerShell `.ps1` che vanno referenziati in `~/.claude/settings.json` (globale) oppure `CLAUDE.md` (per progetto).

```bash
# Verifica che gli hook siano in questo folder
ls hooks/

# Installa in settings.json globali — il command punta a questa repo:
# powershell -File C:\Users\albie\Desktop\Programmi\Linkedin\hooks\<nome>.ps1

# Oppure usa symlink per puntare a questa cartella:
# New-Item -ItemType Junction -Path "$HOME\.claude\hooks" -Target "C:\Users\albie\Desktop\Programmi\Linkedin\hooks"
```

## Matrice hook → eventi

| Hook file | Evento CC | Tipo | Scopo |
|-----------|-----------|------|-------|
| `session-start.ps1` | `SessionStart` | sync | Carica memoria globale, todos, AI_RUNTIME_BRIEF.md |
| `inject-runtime-brief.ps1` | `UserPromptSubmit` | sync | Reinietta AI_RUNTIME_BRIEF.md prima di ogni prompt |
| `skill-activation.ps1` | `UserPromptSubmit` | sync | Routing capability basato su AI_CAPABILITY_ROUTING.json |
| `pre-bash-l1-gate.ps1` | `PreToolUse` (bash git commit) | deny | Blocca commit senza quality gate recente |
| `pre-bash-git-gate.ps1` | `PreToolUse` (bash git commit/push) | deny | Blocca commit/push se repo in stato sbagliato |
| `pre-edit-antiban.ps1` | `PreToolUse` (edit/write su file sensibili) | deny | Blocca modifiche LinkedIn senza antiban-review |
| `post-bash-git-audit.ps1` | `PostToolUse` (bash git commit/push) | async | Log readiness git dopo operazioni |
| `post-bash-quality-log.ps1` | `PostToolUse` (bash npm/npx/vitest) | async | Log comandi qualita' eseguiti |
| `post-edit-antiban-audit.ps1` | `PostToolUse` (edit/write su file sensibili) | async | Audit violazioni antiban post-modifica |
| `file-size-check.ps1` | `PostToolUse` (edit/write) | async | Avviso su file >300 righe per valutare split |
| `stop-session.ps1` | `Stop` | async | Check worklog + active.md + notifica fine sessione |
| `teammate-event.ps1` | `TeammateIdle/TaskCreated/TaskCompleted` | async | Log eventi agent teams |
| `_lib.ps1` | — | — | Libreria condivisa per tutti gli hook |

## File settings.json di esempio

Il template di configurazione hook sta nelle prime ~100 righe di `~/.claude/settings.json`.
Le voci critiche sono:
- `hooks.SessionStart` → `session-start.ps1`
- `hooks.UserPromptSubmit` → `inject-runtime-brief.ps1` + `skill-activation.ps1`
- `hooks.PreToolUse` → vari gate L1, antiban, git
- `hooks.PostToolUse` → vari audit log

## Aggiornamento hook

Quando si modifica un hook in questa cartella:
1. Testare: `cd hooks/tests && pwsh run-all.ps1`
2. Aggiornare il symlink o il path in `settings.json` globali
3. Verificare con `claude` in una nuova sessione che il contesto iniettato sia corretto
4. Commit di questa cartella
