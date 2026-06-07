---
name: audit
description: Mostra lo stato corrente del progetto LinkedIn bot — item aperti in ARCHITETTURA, PROD READINESS, setup ambiente pendente. Attivare con /audit o "cosa manca", "cosa resta da fare", "stato progetto".
---

# Audit Stato Progetto

Quando l'utente vuole sapere cosa manca o cosa resta da fare nel progetto LinkedIn bot:

1. Leggi `C:\Users\albie\.claude\projects\C--Users-albie-Desktop-Programmi-Linkedin\memory\project_next_priorities.md`
2. Per lo stato audit codice leggi `C:\Users\albie\Desktop\Programmi\Linkedin\docs\AI_MASTER_IMPLEMENTATION_BACKLOG.md` (numeri DINAMICI dalla fonte, mai hardcoded; il vecchio `TODO.md` non esiste più)
3. Presenta un report conciso con:
   - **Audit codice**: stato corrente letto dalle fonti sopra (NON un numero fisso)
   - **ARCHITETTURA**: item aperti con file/impatto
   - **PROD READINESS**: checklist con ✅/[ ]
   - **Setup ambiente**: action item pendenti (notebooklm login, PATH, GitLab MCP)
   - **Decisioni sospese**: frontend/, GSD Pro, ecc.

Formato output: tabelle markdown, conciso, actionable. Ogni item deve dire COSA fare, non solo cosa manca.
