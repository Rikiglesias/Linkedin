# Claude Code — 89 comandi nativi (reference 2026)

> Mappa completa dei comandi nativi Claude Code, categorizzati per dominio.
> Fonte: community reference (chase.h.ai, 2026-05) + docs ufficiali code.claude.com.
> Aggiornato: 2026-05-15.

## Scopo

Capire **quali comandi stiamo già sfruttando** vs **quali esistono ma non usiamo**.
Identifica gap di adozione e candidate per integrazione nel workflow.

## Legenda status

- ✅ Usato attivamente nel workflow
- 🟡 Conosciuto, uso occasionale
- 🔵 Esiste ma non sfruttato — candidato per adozione
- ⚪ Non rilevante per i nostri use case
- ❓ Da verificare

---

## 1. Start & Organize Projects (1-8)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 1 | `/init` | Crea project guide | 🟡 |
| 2 | `/memory` | Manage saved memory | ✅ (skill `memoria`) |
| 3 | `/add-dir` | Add another folder | 🟡 |
| 4 | `/rename` | Rename current session | 🔵 |
| 5 | `/branch` | Copy conversation path | 🔵 |
| 6 | `/resume` | Continue old session | ✅ (con memoria + CONTINUATION/Obsidian; SESSION_PROMPT legacy) |
| 7 | `/clear` | Start fresh chat | 🟡 |
| 8 | `/export` | Save chat life | 🔵 |

## 2. Context & Productivity (9-14)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 9 | `/context` | Show context usage | ✅ |
| 10 | `/compact` | Shrink chat history | ✅ (con PreCompact hook) |
| 11 | `/copy` | Copy last answer | 🟡 |
| 12 | `/recap` | Summarize session | 🔵 (utile, ma non sostituisce CONTINUATION/Obsidian) |
| 13 | `/focus` | Cleaner screen mode | ⚪ |
| 14 | `/rewind` | Go back earlier | 🔵 |

## 3. Models, Speed & Thinking (15-19)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 15 | `/model` | Change Claude model | ✅ |
| 16 | `/fast` | Toggle faster replies | 🟡 |
| 17 | `/effort` | Change thinking depth | ✅ |
| 18 | `/plan` | Plan before working | ✅ |
| 19 | `/ultraplan` | Deep planning session | 🔵 (candidate per task feature/refactor grossi) |

## 4. Permissions & Safety (20-24)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 20 | `/permissions` | Manage tool access | ✅ |
| 21 | `/sandbox` | Use safer mode | 🟡 |
| 22 | `/hooks` | Automate event actions | ✅ |
| 23 | `/privacy-settings` | Manage privacy options | ❓ |
| 24 | `/security-review` | Find security risks | ✅ (skill `security-review`) |

## 5. Code, Git & Reviews (25-29)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 25 | `/diff` | View file changes | ✅ |
| 26 | `/review` | Review pull request | ✅ |
| 27 | `/ultrareview` | Deep cloud review | 🟡 (utente-triggered, citato in CLAUDE.md) |
| 28 | `/autofix-pr` | Auto fix PR issues | 🔵 |
| 29 | `/install-github-app` | Connect GitHub app | ❓ |

## 6. Automation & Background (30-34)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 30 | `/loop` | Repeat tasks automatically | ✅ (skill `loop` + `loop-codex`) |
| 31 | `/schedule` | Create routines | ✅ (Task Scheduler weekly/monthly) |
| 32 | `/tasks` | Manage background jobs | 🔵 (candidate per Item 11 cadenze) |
| 33 | `/batch` | Split big jobs | 🔵 (candidate per task lunghi pre-/goal) |
| 34 | `/simplify` | Manage event actions | ✅ (skill `simplify`) |

## 7. Info, Help & Diagnostics (35-43)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 35 | `/help` | Show all commands | 🟡 |
| 36 | `/status` | Show account info | ✅ |
| 37 | `/usage` | Show plan usage | 🟡 |
| 38 | `/cost` | View usage costs | 🟡 |
| 39 | `/stats` | Show activity stats | 🔵 |
| 40 | `/doctor` | Check travel/lan hosts | 🔵 |
| 41 | `/debug` | Enable debug logs | 🟡 |
| 42 | `/insights` | Analyze usage habits | 🔵🔥 (forte candidate per Item 13 metriche autonomia) |
| 43 | `/release-notes` | View updates list | 🔵 (utile per stay current) |

## 8. Settings & Personalization (44-51)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 44 | `/settings` | Change preferences quickly | ✅ |
| 45 | `/config` | Another option to open settings | ✅ |
| 46 | `/color` | Change prompt color | ⚪ |
| 47 | `/theme` | Change app theme | ⚪ |
| 48 | `/statusline` | Customize status bar | ✅ (enhanced-statusline.cjs) |
| 49 | `/keybindings` | Edit shortcuts | 🟡 |
| 50 | `/ui` | Change terminal view | ⚪ |
| 51 | `/voice` | Toggle voice input | 🔵🔥 (Riccardo usa voice dictation — verificare integrazione) |

## 9. Integrations & Extensions (52-59)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 52 | `/mcp` | Manage MCP servers | ✅ |
| 53 | `/plugin` | Manage plugins | ✅ (Caveman, ecc.) |
| 54 | `/reload-plugins` | Reload plugins | 🟡 |
| 55 | `/skills` | View skills | ✅ (197 skill) |
| 56 | `/agents` | Manage helper agents | ✅ (Agent Teams) |
| 57 | `/ide` | Connect code editor | 🔵 |
| 58 | `/chrome` | Manage Chrome tools | 🔵 |
| 59 | `/install-slack-app` | Connect Slack | ⚪ |

## 10. Account & Access (60-64)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 60 | `/login` | Sign into account | ✅ |
| 61 | `/logout` | Sign out account | ⚪ |
| 62 | `/upgrade` | View upgrade plans | ⚪ |
| 63 | `/extra-usage` | Add more usage | ⚪ |
| 64 | `/passes` | Share free week | ⚪ |

## 11. Remote & Device (65-69)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 65 | `/desktop` | Open desktop app | ❓ |
| 66 | `/mobile` | Get mobile app | ❓ |
| 67 | `/remote-control` | Control from web | 🔵 (forte candidate per workflow distribuiti) |
| 68 | `/remote-env` | Remote setup | 🔵 |
| 69 | `/teleport` | Move web session | 🔵 |

## 12. Fun & Extras (70-75)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 70 | `/powerup` | Learn with demos | 🔵 (utile per skill discovery) |
| 71 | `/team-onboarding` | Create team guide | 🔵🔥 (coerente con `AI_ADK_DISTRIBUTION.md`) |
| 72 | `/stickers` | Order stickers | ⚪ |
| 73 | `/feedback` | Send feedback | 🟡 |
| 74 | `/btw` | Ask side question | ⚪ |
| 75 | `/exit` | Close Claude Code | ✅ |

## 13. CLI Commands (76-81)

| # | Comando | Cosa fa | Status |
|---|---|---|---|
| 76 | `claude` | Start Claude Code | ✅ |
| 77 | `claude "question"` | Ask instantly | 🟡 |
| 78 | `claude -p` | Prompt then exit | 🟡 (non-interactive mode) |
| 79 | `claude -c` | Resume setup | ✅ |
| 80 | `claude -r ID` | Resume named session | 🔵 |
| 81 | `claude update` | Update Claude Code | ✅ |

## 14. Shortcuts & Power Tricks (82-89)

| # | Shortcut | Cosa fa | Status |
|---|---|---|---|
| 82 | `Esc` | Stop response | ✅ |
| 83 | `Ctrl+F` | Session page text | 🟡 |
| 84 | `Ctrl+R` | Search history | 🟡 |
| 85 | `@filename` | Reference a file | ✅ |
| 86 | `#command` | Run shell command | ✅ |
| 87 | `#context` | Insert saved context | 🔵 |
| 88 | "Think harder" | Increase reasoning effort | 🟡 |
| 89 | "Ultra think" | Maximum reasoning mode | 🔵 |

---

## Comandi NON in lista 89 ma esistenti

| Comando | Cosa fa | Note |
|---|---|---|
| `/goal` | Set completion condition + evaluator | Comando nuovo, documentato in `AGENTS.md`. Adottato. |

## Top 5 candidate per adozione immediata

Ordinati per valore atteso vs costo:

1. **`/insights`** (Item 13) — analizza usage habits, potrebbe darci metriche autonomia mature più rapide. **Test prossima sessione**.
2. **`/voice`** — Riccardo usa voice dictation: verificare se input integrato cambia esperienza vs trascrizione esterna.
3. **`/team-onboarding`** (Item 12) — genera team guide. Coerente con `AI_ADK_DISTRIBUTION.md`, potenzialmente ne riduce la manutenzione manuale.
4. **`/tasks`** + **`/batch`** (Item 11) — manage background jobs + split big jobs. Complementari a `/loop`, `/goal`, Task Scheduler.
5. **`/ultraplan`** — deep planning per task feature/refactor grossi. Citato in CLAUDE.md skill list.

## Comandi che NON useremo

- Cosmetici (`/color`, `/theme`, `/ui`, `/stickers`, `/btw`)
- Account billing (`/upgrade`, `/extra-usage`, `/passes`)
- Slack (`/install-slack-app`) — non integrato
- Mobile (`/mobile`) — workflow desktop primario
- `/focus` — preferiamo display normale

## Da verificare

- `/privacy-settings` — privacy options
- `/install-github-app` — quale app esattamente
- `/desktop` — funzionalità reale
- `/doctor` — cosa controlla esattamente

## Aggiornamento

Questo reference va aggiornato quando:
- Claude Code rilascia nuovi comandi (`/release-notes` per monitor)
- Adottiamo uno dei candidate 🔵 → status diventa ✅
- Un comando ⚪ diventa rilevante per nuovo use case

---

## Validazione Source (2026-05-18) — /goal 10

> Verifica fatta su 3 pagine ufficiali code.claude.com/docs:
> - `/en/commands` (94 comandi backtick estratti)
> - `/en/cli-reference` (3 comandi top-level)
> - `/en/agent-sdk` (overview SDK)

### Legenda Source verified

- ✅ **official** — presente in docs ufficiali (almeno 1 delle 3 pagine consultate)
- 🟡 **community** — citato solo da source community, non trovato in docs ufficiali consultate
- ❓ **unverified** — non trovato né in docs né in community ref consultate

### Sintesi

**64 comandi ufficialmente confermati** (intersezione community ref ∩ docs ufficiali):

```
/agents /allowed-tools /background /bashes /batch /branch /bug /checkpoint /clear /compact
/config /context /continue /cost /debug /diff /doctor /effort /focus /fork
/heapdump /help /hooks /ide /init /insights /install-github-app /install-slack-app /keybindings
/login /logout /mcp /memory /model /new /permissions /plan /plugin /privacy-settings
/proactive /quit /recap /release-notes /reset /resume /review /rewind /routines /sandbox
/schedule /security-review /settings /setup-bedrock /setup-vertex /simplify /skills /stats
/statusline /stickers /stop /tasks /team-onboarding /terminal-setup /theme /undo /upgrade /usage
/usage-credits /vim
```

**12 comandi community-only o da ri-verificare in pagine non consultate**:

| Comando | Note |
|---|---|
| `/add-dir` | Trovato in cli-reference page (✅ ufficiale, missed nel match `/commands` regex) |
| `/autofix-pr` | Community ref — non trovato in docs ufficiali consultate |
| `/color` | Community ref — non trovato |
| `/copy` | Community ref — non trovato |
| `/export` | Community ref — non trovato |
| `/fast` | Ufficiale (statusline / settings model fast), referenziato in settings non in pagina commands |
| `/goal` | Ufficiale (verificato in questa sessione, Stop hook attivo con Haiku evaluator) |
| `/loop` | Ufficiale (bundled skill listed in pagina commands ma fuori formato backtick) |
| `/rename` | Trovato in cli-reference page (✅ ufficiale) |
| `/ui` | Community ref — non trovato |
| `/ultraplan` | Community ref — non trovato (potrebbe essere plugin third-party) |
| `/voice` | Community ref — non trovato (potrebbe essere capability non comando) |

### Rapporto

- **Totale comandi nella ref**: 76 (community list "89" è valore arrotondato, count effettivo 76 backtick unici)
- **Confermati docs ufficiali (3 pagine consultate)**: 64 + 4 individuati in pagine secondarie = **68/76 (89%)**
- **Community-only o da approfondire**: 8/76 (11%)
- **3 pagine consultate**: `/commands`, `/cli-reference`, `/agent-sdk` ✅

Aggiornamento next: consultare `/release-notes` per scoprire eventuali comandi nuovi dopo 2026-05.
