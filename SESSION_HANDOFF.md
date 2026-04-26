# Handoff Sessione 2026-04-26

## Obiettivo di sessione
- Correggere errori sistematici nei hook Claude Code (schema JSON sbagliato per PreCompact e Stop)
- Rendere permanenti i permessi AI (bypassPermissions globale)
- Fixare il compact che si rompe con modelli OpenRouter (GLM, Kimi, ecc.)
- Globalizzare tutti gli hook utili dal progetto LinkedIn

## Stato completato

- [x] Fix _lib.ps1: Write-HookAdditionalContext emette systemMessage per PreCompact e Stop
- [x] Fix pre-stop-commit-gate.ps1: schema JSON Stop corretto
- [x] bypassPermissions globale in ~/.claude/settings.json + skipDangerousModePermissionPrompt
- [x] Fix compact OpenRouter: isCompactRequest() in claude-model-router.mjs forza Anthropic Sonnet
- [x] Hook globalizzati: skill-precheck, skill-routing, model-suggestion, pre-edit-secrets
- [x] Nuovo hook pre-edit-verify-intent.ps1: verifica codebase prima di correggere
- [x] Fix antiban falso positivo: .md/.txt/.log esclusi da Test-AntibanFile

## Stato in progress

- tools/ directory: untracked, decisione pendente (gitignore o commit)

## File toccati (sessione)

Globali (~/.claude/):
- M: hooks/_lib.ps1 — systemMessage per Stop/PreCompact + whitelist ext doc
- M: hooks/pre-stop-commit-gate.ps1 — fix JSON schema
- M: settings.json — bypassPermissions + nuovi hook
- M: scripts/claude-model-router.mjs — isCompactRequest()
- A: hooks/user-prompt-skill-precheck.ps1
- A: hooks/user-prompt-skill-routing.ps1
- A: hooks/user-prompt-model-suggestion.ps1
- A: hooks/pre-edit-secrets.ps1
- A: hooks/pre-edit-verify-intent.ps1

## Decisioni prese

- PreCompact e Stop usano systemMessage al root (non hookSpecificOutput)
- Compact forzato su Anthropic nel router locale, non negli hook
- Hook generici → globali. Hook LinkedIn-specifici → restano nel progetto
- Estensioni .md/.txt/.log escluse dall'antiban (mai codice sensibile)

## Problemi aperti

- tools/ untracked: decidere gitignore vs commit
- post-bash-auto-push.ps1:117 errore non bloccante, non analizzato

## Prossimi passi

1. Decidere tools/ (gitignore consigliato)
2. Fix post-bash-auto-push.ps1:117
3. Testare /compact con GLM/Kimi su chat nuova
4. Riprendere backlog LinkedIn: lifecycle + control plane

## Branch

- main: 1 commit ahead origin/main (non pushato)

## Note

- ~/.claude/ NON e' un repo git: modifiche hooks/settings non si committano automaticamente
- Router riavviare dopo modifiche a claude-model-router.mjs
- tools/ contiene strumenti terze parti, non parte del core LinkedIn
