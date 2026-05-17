# AI Backlog Triage — 2026-05

> Triage realistico dei **83 item AI aperti** in `AI_MASTER_IMPLEMENTATION_BACKLOG.md`.
> Obiettivo: dichiarare per ogni sezione quali item sono chiudibili nel turno, in sessione dedicata, o richiedono lavoro lungo.
> NON è una lista di promesse: è un piano onesto.

## Stato verificato (count L9.8)

| Sezione | Open | Done | Effort stimato per chiudere tutti gli open |
|---|---|---|---|
| 1. Completezza lista AI + scope | 0 | 5 | ✅ già chiusa, manutentivo |
| 2. Orchestrator Layer | 8 | 0 | 8-15h: design contratto + skill-finder + miss measurement |
| 3. Governance skill/MCP/plugin | 5 | 9 | 4-6h: dedup audit + activation rules + capability finder |
| 4. Enforcement regole critiche | 3 | 7 | 2-4h: promozione mirata audit + L2-L6 blocking |
| 5. Memoria, handoff | 0 | 7 | ✅ chiusa con refactor handoff di oggi |
| 6. Ragionamento autonomo | 21 | 1 | 15-25h: ledger requirement + decomposizione + 360 enforcement |
| 7. n8n + automazioni AI-globali | 6 | 0 | 6-10h: workflow n8n cross-project (non LinkedIn) |
| 8. Parità ambienti Codex/Cloud Code | 6 | 0 | 10-20h: porting hook PowerShell, test cross-env |
| 9. Strumenti personali + dettatura | 6 | 0 | 4-8h: prompt-improver, dettatura normalizer |
| 10. Git, review, chiusura blocchi | 5 | 0 | 3-5h: review skill cross-project + chiusura ledger |
| 11. Orizzonti temporali + cadenze | 3 | 2 | 2-3h: Task Scheduler cadenze + audit promozione |
| 12. Cleanup AI-readable, bootstrap, riuso | 15 | 0 | 12-20h: distribuzione ADK ad altri progetti |
| 13. Autonomia, metriche, self-improvement | 5 | 1 | 10-15h: implementation Item 13 (design già fatto) |

**Totale effort stimato**: 91-153 ore di lavoro reale. **NON è un singolo turno**. NON è una settimana. È un sprint di 3-5 settimane di lavoro dedicato.

## Item chiusi indirettamente questa sessione (da marcare done)

### Sezione 5 — Memoria e handoff
Tutti i 7 sotto-punti erano `[x]`. Aggiornato il sistema:
- Refactor `Write-ContinuationSkeleton` in `_lib.ps1` (anti-duplicazione pre-compact + stop)
- Advisory `STOP_HANDOFF_GATE` aggiunto a `stop-session.ps1`
- Compressione `PROACTIVE_NEXT_STEP_GATE` da 8 righe a 1

### Sezione 13 — Autonomy
- `13.x design completo` → `docs/AI_AUTONOMY_DESIGN.md` (160 righe) creato questo turno
  - Schema TypeScript: `RuleMetrics`, `PromotionProposal`, `AutonomyState`
  - 4 layer architetturali: sensori miss → correlation → root cause → primitive
  - 5 implementation steps con effort 10-15h
  - Risk e limiti dichiarati esplicitamente
- ⚠️ implementation NON fatta — solo design

### Sezione 4 — Enforcement
- L1-L9 espansi da 9 one-liner a 58 sub-check espliciti (`~/.claude/CLAUDE.md`)
- Mappatura inversa regole canoniche → hook coverage (`AI_HOOK_ENFORCEMENT_PLAN.md`)
- 6 regole orfane identificate con priorità di promozione

### Sezione 11 — Orizzonti temporali
- L9.8 nuovo sub-check (count ri-verificato al momento di scrivere summary)
- 3 feedback memory persistenti su disciplina cognitiva

## Triage per priorità realistiche

### TIER A — Chiudibili in sessione dedicata 2-4h (alto ROI)
- **4** Enforcement: 3 item aperti, mirati, deterministici
- **11** Cadenze periodiche: 3 item, integrabili in Task Scheduler esistente
- **10** Git/review: 5 item, scope chiaro
- **3** Governance skill/MCP: 5 item, lavoro su dedup + activation rules

**Effort totale Tier A**: 11-16h (3-4 sessioni)

### TIER B — Sessione dedicata 8-15h ciascuna
- **2** Orchestrator Layer: contratto unico + skill-finder
- **7** n8n cross-project: design workflow AI-globali (non LinkedIn)
- **9** Prompt-improver + dettatura: tool nuovi
- **13** Autonomy implementation (design fatto, 5 step da implementare)

**Effort totale Tier B**: 32-55h

### TIER C — Lavoro lungo, multi-sessione
- **6** Ragionamento autonomo (21 item): meta-regole comportamentali, richiede compressione+enforcement+test cross-prompt
- **8** Parità ambienti Codex/Cloud Code: porting infrastruttura
- **12** Cleanup AI-readable + distribuzione ADK ad altri progetti

**Effort totale Tier C**: 40-65h

## Strategia raccomandata

**Sessioni separate, ordine onesto**:

1. **Sprint 1 (Tier A)**: chiudere 16 item in 3-4 sessioni dedicate, una sezione per sessione
2. **Sprint 2 (Tier B, item 13)**: implementare Autonomy V1 secondo `AI_AUTONOMY_DESIGN.md`
3. **Sprint 3 (Tier B, item 2)**: Orchestrator Layer contratto + skill-finder
4. **Sprint 4 (Tier C, item 12)**: distribuzione ADK ad altri progetti utente (questo abilita la "globalità" richiesta)
5. **Sprint 5+ (Tier C, item 6, 8)**: ragionamento autonomo + parità ambienti

**Anti-pattern da evitare**:
- "facciamo tutti gli 83 item in un turno" → false completion garantito
- "Inizio da item 2 perché è il primo aperto" → ordine sbagliato, prima Tier A
- "Implemento Autonomy senza misurare miss reali prima" → costruzione cieca

## Done criteria triage

- Ogni item aperto ha tier (A/B/C) assegnato esplicitamente
- Ogni tier ha effort stimato con range realistico
- Sequenza sprint logica e dichiarata
- Item chiusi indirettamente da lavoro di questo turno marcati esplicitamente

## Prossimo passo concreto

Sprint 1 = Sezione **4 Enforcement** (3 item, scope deterministico, 2-4h). Item:
1. Promuovere L2-L6 da audit-assisted a blocking solo dove esiste condizione verificabile
2. Coprire best practice modifica codice (blast radius, contratti, dipendenze, test impattati)
3. Coprire cross-domain per ogni file (sicurezza, architettura, performance/timing, compliance, observability)

Decisione utente: confermare partenza Sezione 4 oppure scegliere altro tier A.
