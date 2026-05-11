# Agent Development Kit — source screenshots

Archivio delle immagini WhatsApp usate come input per i requisiti del sistema AI.

Fonte visiva: post Instagram `leadgenman` su "The Agent Development Kit".

## Contenuto verificato

| File | Slide | Contenuto utile |
| --- | --- | --- |
| `01-adk-overview-five-layers.jpeg` | 1/7 | Overview ADK: `CLAUDE.md`, Skills, Hooks, Subagents, Plugins come cinque layer dello stack. Include ruolo laterale di MCP/server esterni e agent teams. |
| `02-layer-1-claude-md-memory.jpeg` | 2/7 | Layer 1: `CLAUDE.md` come memory layer sempre caricato. Distingue globale `~/.claude/CLAUDE.md` e progetto `.claude/CLAUDE.md`; include architecture rules, naming, test expectations e repo map. |
| `03-layer-2-skills-knowledge.jpeg` | 3/7 | Layer 2: Skills come knowledge layer on-demand, modulari e auto-invocate da descrizione. Struttura: `SKILL.md`, `scripts/`, `templates/`, `assets/`. |
| `04-layer-3-hooks-guardrails.jpeg` | 4/7 | Layer 3: Hooks come guardrail deterministici, non AI. Trigger su eventi agent/tool; esempi `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `SubagentStop`. |
| `05-layer-4-subagents-delegation.jpeg` | 5/7 | Layer 4: Subagents come delegazione con context window propria. Il parent pianifica, il child fa un job e ritorna un solo risultato. |
| `06-layer-5-plugins-distribution.jpeg` | 6/7 | Layer 5: Plugins come distribution layer. Manifest `plugin.json`, marketplace/install, bundle di skills, agents, hooks e commands. |

## Nota

Le immagini locali coprono slide 1/7-6/7. La slide 7/7 non era presente tra i file da archiviare.

## Impatto sui requisiti AI

Queste immagini supportano il punto sulla governance Agent Development Kit:

- regole/memoria: `CLAUDE.md` o equivalenti canonici
- skill: procedure cognitive o operative riusabili
- hook: guardrail deterministici e auditabili
- subagent: delegazione isolata con output controllato
- plugin/distribution: pacchetto installabile e versionato
- MCP: tool esterni, distinti da skill/hook/plugin
