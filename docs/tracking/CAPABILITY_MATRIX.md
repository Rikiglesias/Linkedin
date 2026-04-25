# Capability Matrix — Ambienti AI

> Aggiornato: 2026-04-25
> Fonte primaria: AI_MASTER_IMPLEMENTATION_BACKLOG.md §5
> Aggiornare quando cambia enforcement, tool o comportamento reale.

## Legenda

| Simbolo | Significato |
|---------|-------------|
| ✅ | Supportato nativamente, verificato |
| ⚠️ | Workaround necessario o parziale |
| ❌ | Non disponibile / non affidabile |
| 🔄 | Da verificare con task reale |

---

## Matrix

| Capability | Claude Code | Codex CLI | Cursor/Windsurf |
|-----------|-------------|-----------|-----------------|
| **Canonici (AGENTS.md/CLAUDE.md)** | ✅ caricato da CLAUDE.md + AGENTS.md | ✅ via AGENTS.md | ⚠️ prompt esplicito richiesto |
| **Memory files (~/.claude/memory/)** | ✅ SessionStart hook inietta | ❌ nessun hook nativo | ❌ |
| **Runtime brief (AI_RUNTIME_BRIEF.md)** | ✅ SessionStart + UserPromptSubmit | ⚠️ AGENTS.md lo include ma non è reiniettato | ❌ |
| **Hook (PreToolUse/PostToolUse/Stop)** | ✅ settings.json | ❌ non supportato | ❌ |
| **MCP server** | ✅ .mcp.json | ❌ | ⚠️ alcuni supportati |
| **Skill (Skill tool)** | ✅ | ❌ | ❌ |
| **Git gate L1 (blocking)** | ✅ pre-commit hook | ⚠️ solo se repo hook attivi | ⚠️ |
| **L2-L6 advisory** | ✅ skill-activation.ps1 | ❌ nessun hook | ❌ |
| **L7-L9 skill-gated** | ✅ verification-protocol | ❌ | ❌ |
| **Antiban review** | ✅ PreToolUse hook deny | ❌ | ❌ |
| **RTK (bash compression)** | ✅ PreToolUse hook | ❌ | ❌ |
| **Dippy (auto-approve bash)** | ✅ PreToolUse hook | ❌ | ❌ |
| **code-review-graph MCP** | ✅ | ❌ | ❌ |
| **lean-ctx MCP** | ✅ | ❌ | ❌ |
| **symdex MCP** | ✅ | ❌ | ❌ |
| **Supabase MCP** | ✅ | ❌ | ❌ |
| **Playwright MCP** | ✅ | ❌ | ❌ |
| **n8n MCP** | ✅ | ❌ | ❌ |
| **PAUL (plan/apply/unify)** | ✅ | ❌ | ❌ |
| **autoresearch loops** | ✅ | ❌ | ❌ |
| **context-handoff skill** | ✅ | ❌ | ❌ |
| **superpowers plugin** | ✅ | ❌ | ❌ |
| **token-optimizer** | ✅ | ❌ | ❌ |
| **caveman mode** | ✅ | ❌ | ❌ |
| **Agent teams (Agent tool)** | ✅ | ❌ | ❌ |
| **Commit intelligente** | ✅ git-commit skill | ⚠️ manuale | ⚠️ manuale |
| **WebSearch tool** | ✅ | ✅ | ✅ |
| **Bash tool** | ✅ | ✅ | ✅ |
| **Read/Write/Edit tools** | ✅ | ✅ | ✅ |
| **Plan mode** | ✅ | 🔄 | 🔄 |

---

## Gap critici per Codex

| Gap | Impatto | Fallback |
|-----|---------|----------|
| Nessun hook | L2-L9 non enforced, antiban non bloccato | AGENTS.md con regole esplicite, manuale |
| Nessuna memoria | Contesto non persiste | AGENTS.md include subset memoria |
| Nessun MCP | DB, browser, n8n non accessibili | API dirette dove possibile |
| Nessuna skill | Workflow specializzati non attivabili | Prompt esplicito |

**Regola operativa**: Codex usabile solo per task puramente interni al repo (refactor, fix, read) dove non serve stato esterno, MCP o enforcement avanzato. Tutto il resto → Claude Code.

---

## Policy ambiente per tipo task

| Tipo task | Ambiente preferito | Motivo |
|-----------|-------------------|--------|
| LinkedIn bot (qualsiasi) | Claude Code | Antiban hook obbligatorio |
| Feature >3 file | Claude Code | PAUL + L7-L9 + code-review-graph |
| Debug con log/DB/browser | Claude Code | MCP Playwright/Supabase |
| Refactor puro interno | Codex o Claude Code | Entrambi ok |
| Audit sicurezza | Claude Code | Semgrep + autoresearch:security |
| Obsidian/Brain vault | Claude Code (cwd=Desktop/Brain) | obsidian-mind + skills |
| Domanda rapida / read-only | Codex accettabile | Nessun rischio |
