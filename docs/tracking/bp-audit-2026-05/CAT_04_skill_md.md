## Categoria 4 — Skill SKILL.md

### Fonti best practice consultate (2026)

- [Anthropic Claude Code: Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Anthropic platform: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Anthropic skills repo: skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- [Claude Skill Frontmatter complete guide 2026](https://allahabadi.dev/blogs/ai/claude-code-skills-frontmatter-complete-guide/)

### Best practice ufficiali identificate

| BP | Cosa dice Anthropic | Severity |
|---|---|---|
| Filename canonico | `SKILL.md` (uppercase) — caricato automaticamente dal loader | HIGH |
| Frontmatter required | `name` (≤64 char, lowercase/numeri/hyphen) + `description` (≤1024 char) | HIGH |
| Description "pushy" | Descrizione attivante che cita trigger phrase per evitare under-triggering | MEDIUM |
| Body size | <500 righe nel SKILL.md; oltre → split in `references/` con progressive disclosure | MEDIUM |
| `disable-model-invocation` | Opzionale: true se attivazione solo manuale via `/skill-name` | LOW |
| `user-invocable` | Opzionale: false se background knowledge non callabile da user | LOW |
| `allowed-tools` | Opzionale: lista tool ammessi nel scope della skill | LOW |

### Stato nostro sistema

| Metrica | Valore |
|---|---|
| Skill installate (`~/.claude/skills/`) | **197** |
| Conformi `SKILL.md` (uppercase) | **185** (94%) |
| Non conformi `skill.md` lowercase | **8** |
| Non conformi `index.md` | **3** |
| Tasso conformità filename | **94%** |

**Skill non conformi (project-critical bold)**:

| Path | Filename attuale | Project-critical |
|---|---|---|
| `audit-rules/index.md` | `index.md` | **sì** |
| `context-handoff/skill.md` | `skill.md` | **sì** |
| `git-commit/skill.md` | `skill.md` | **sì** |
| `git-create-pr/skill.md` | `skill.md` | **sì** |
| `linkedin-patterns/skill.md` | `skill.md` | **sì** |
| `loop-codex/skill.md` | `skill.md` | **sì** |
| `memoria/skill.md` | `skill.md` | **sì** |
| `prompt-improver/skill.md` | `skill.md` | no |
| `session-prompt/index.md` | `index.md` | sì |
| `token-efficiency/skill.md` | `skill.md` | no |
| `verification-protocol/index.md` | `index.md` | **sì** |

### Verifica empirica

Le skill non conformi **sono caricate** lo stesso da Claude Code (evidenza: `/context` mostra `loop-codex ~100 tokens`, `context-handoff ~80 tokens`, `git-commit ~70 tokens`, `memoria ~70 tokens` — tutte effettivamente caricate). Quindi il loader accetta filename varianti come fallback. Ma:
- **Non documentato**: il behavior potrebbe cambiare in future versioni di Claude Code
- **skill-creator ufficiale** genera sempre `SKILL.md`
- **Audit interni** potrebbero non riconoscerle come "skill canoniche"

### Antiban-review come reference

Il file `antiban-review/SKILL.md` è conforme:
- Filename `SKILL.md` ✅
- Frontmatter `name` + `description` con trigger phrase pushy ✅
- Pre-conditions/post-conditions strutturate ✅
- Body sotto soglia ✅

### Gap identificati

| # | Gap | Severity | File coinvolti |
|---|---|---|---|
| 1 | 11 skill con filename non canonico | MEDIUM | 11 file in `~/.claude/skills/*/` |
| 2 | Inconsistenza tra `skill.md` e `index.md` come fallback | LOW | 3 + 8 file |
| 3 | Nessun audit script che verifica conformità filename skill | LOW | mancante |

### Fix proposti — NON applicati in questo turno

**Rationale Pazienza vs fretta**: rinominare 11 file cross-project ha blast radius non locale (potrebbero esserci reference hardcoded in altri progetti dell'utente). Richiede:
1. Sign-off esplicito utente
2. Audit reference: `grep` per `skill.md` e `index.md` in tutti i progetti dell'utente prima del rename
3. Test che ogni skill rinominata continui a caricare correttamente

**Proposta operativa** (futura):
1. Rinominare via `git mv` o batch script: `for d in audit-rules context-handoff git-commit git-create-pr linkedin-patterns loop-codex memoria prompt-improver session-prompt token-efficiency verification-protocol; do mv ~/.claude/skills/$d/{skill,index}.md ~/.claude/skills/$d/SKILL.md; done` (preceduto da check filename effettivo)
2. Aggiungere TypeScript audit `src/scripts/skillFilenameAudit.ts` che fallisce se trova `skill.md`/`index.md` in `~/.claude/skills/`
3. Aggiungere check a `audit:weekly` per regressione

**Risk**: basso (filename rename non cambia contenuto), ma cross-project blast radius richiede conferma utente.

---

