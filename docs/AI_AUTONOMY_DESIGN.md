# AI Autonomy — Design doc (Item 13 backlog)

> Design completo per il sistema di autonomia auto-correttiva: miss → root cause → primitive correttiva automatica. **Documento di progettazione**, implementation NON ancora iniziata.

## Obiettivo

Trasformare il sistema AI da reattivo (l'utente nota un errore → corregge) a auto-correttivo (il sistema rileva pattern di miss ricorrenti → propone promozione automatica della regola).

## Stato attuale (problema verificato)

- 34 hook attivi loggano violazioni su `~/memory/*.txt` (advisory + blocking)
- Nessun sistema aggrega i log per identificare miss ricorrenti
- Le promozioni regola → hook avvengono ad-hoc, dipendenti dalla memoria dell'utente
- Regola `feedback_metrics_activations_vs_miss` salvata in memoria distingue activations da miss veri ma non è automatizzata

## Architettura proposta (4 layer)

### Layer 1 — Sensori miss

Aggrega log esistenti da `~/memory/`:

| File log | Cosa contiene | Volume tipico |
|---|---|---|
| `antiban-hook-log.txt` | Pre-edit antiban blocchi | bassa frequenza, alto valore |
| `rule-violations-log.txt` | Violazioni regole specifiche | media frequenza |
| `best-practice-log.txt` | Best practice advisory | alta frequenza |
| `codebase-hygiene-log.txt` | Hygiene advisory | alta frequenza |
| `recap-check-log.txt` | Multi-file recap | media |
| `proactive-next-step-log.txt` | Proactive stop advisory | alta frequenza |
| `quality-hook-log.txt` | Quality gate run | media |
| `git-hook-log.txt` | Git readiness | media |
| `model-suggestion-log.txt` | Model suggestion advisory | bassa |
| `compact-handoff-log.txt` | PreCompact events | bassa |
| `session-log.txt` | Stop session events | bassa |
| `subagent-log.txt` | Subagent stops | bassa |

**Output L1**: stream eventi timestamped `{regola, evento_type, file_target?, dettaglio}` su 30 giorni.

### Layer 2 — Correlation engine

Script TypeScript `src/scripts/missCorrelationAudit.ts`:

```typescript
type MissEvent = {
  timestamp: Date;
  regola: string;
  eventType: 'activation' | 'violation_blocked' | 'violation_passed' | 'advisory_ignored';
  fileTarget?: string;
  detail: string;
};

type RuleMetrics = {
  regola: string;
  activations: number;        // count totale (regola triggered)
  blockingActions: number;    // count bloccato (hook ha fermato)
  violationsPassed: number;   // miss VERI: pattern violato senza blocco
  advisoryIgnored: number;    // hook adv emesso ma comportamento successivo lo ignora
  trueMissRate: number;       // violationsPassed / activations
};
```

**Pattern detection**:
1. **Per ogni regola**, calcolare:
   - activations (trigger del hook)
   - actual blocks (hook ha fermato l'azione)
   - missed (regola dovrebbe trigger ma il comportamento successivo mostra che è stata ignorata)
2. **Identificare miss veri**: distinguere "activation" da "miss" usando `missPattern: RegExp` per file log (già implementato in `missMetricsAudit.ts`)
3. **Heuristic miss "indiretti"**: cercare nel log successivo (~10 min dopo activation) eventi che indicano regola NON seguita (es. commit senza quality gate, edit file LinkedIn senza antiban-review)

### Layer 3 — Root cause classifier

Mappa miss → categoria di problema:

| Pattern miss | Root cause categoria | Primitive correttiva proposta |
|---|---|---|
| Hook advisory emesso, comportamento successivo lo ignora | **Cognitivo**: regola dimenticata | Promozione skill (es. da advisory a sub-check L automatico) |
| Pattern triggerato ma hook non blocca | **Strutturale**: enforcement mancante | Nuovo hook bloccante (esempio: blocking commit se MEMORY.md non aggiornato) |
| Regola scritta ma non in canonici reiniettati | **Documentale**: visibilità bassa | Add a runtime brief (sezione P0) |
| Regola in canonico ma testo lungo, modello la trova ma non la applica | **Compressione**: prosa troppo lunga | Compressione + estrazione in path-scoped rule |

### Layer 4 — Primitive correttiva automatica

Per categorie con miss >5 in 30 giorni:

1. **Genera draft di promozione** in `docs/tracking/AUTONOMY_PROPOSALS.md`
2. **Formato proposta**:
   ```markdown
   ## Proposta {data} — {regola}
   - Miss rilevati: N in K giorni
   - Pattern: {dettaglio}
   - Root cause: {categoria}
   - Primitive proposta: {hook|skill|runtime brief|path-scoped rule}
   - Diff stimato: {file da modificare, righe da aggiungere/rimuovere}
   - Bloccato per: review utente (auto-apply NON consigliato — alto blast radius)
   ```
3. **Notifica**: stessa proposta come Telegram alert se severity HIGH
4. **Cadenza**: integrato in `audit:monthly` (esecuzione 1° del mese)

## Schema dati

```typescript
interface AutonomyState {
  lastRunAt: Date;
  scanWindowDays: number;     // default 30
  rules: RuleMetrics[];
  proposals: PromotionProposal[];
}

interface PromotionProposal {
  id: string;
  generatedAt: Date;
  regola: string;
  missCount: number;
  daysWindow: number;
  rootCauseCategory: 'cognitivo' | 'strutturale' | 'documentale' | 'compressione';
  primitiveType: 'hook' | 'skill' | 'runtime-brief' | 'path-scoped-rule';
  draftDiff: string;          // markdown-friendly representation
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'applied';
  reviewNotes?: string;
}
```

Storage: `docs/tracking/AI_AUTONOMY_STATE.json` (versionato, sopravvive sessioni).

## Implementation steps

1. **Step 1 (4-6h)**: scrivere `missCorrelationAudit.ts` con Layer 1+2 (sensori + correlation, no classifier ancora)
2. **Step 2 (2-3h)**: aggiungere Layer 3 classifier con mapping pattern → categoria
3. **Step 3 (2-3h)**: aggiungere Layer 4 proposal generator
4. **Step 4 (1-2h)**: integrazione `audit:monthly` + Telegram alert
5. **Step 5 (1h)**: test end-to-end su 7 giorni di log reali

**Effort totale**: 10-15 ore. Sessione dedicata, NON fattibile in turno chat.

## Done criteria (verificabili)

- `npm run audit:autonomy` ritorna proposal valide su 30 giorni di log
- Proposal include diff stimato (no allucinazioni)
- Proposal NON si auto-applica (sempre review utente per primitive nuove)
- Integrato in `audit:monthly` con cadenza configurata in Windows Task Scheduler
- Documentato in `AGENTS.md` o `AI_OPERATING_MODEL.md`

## Risk e limiti

- **False positive**: hook advisory log molto rumoroso → classifier può proporre promozioni inutili. Mitigation: soglia miss >5 + filtro su violationsPassed (non solo activations).
- **Race condition**: log scritti in parallelo da hook diversi → atomic append richiesto. PowerShell hook usano già `Add-Content` (atomic).
- **Drift schema log**: se nuovo hook usa formato diverso, classifier potrebbe non parserlo. Mitigation: schema verification in `audit:weekly`.
- **Blast radius proposta auto-applicata**: nessun auto-apply per V1. Tutte le proposte richiedono review esplicita.

## Out of scope (esplicito)

- **Auto-apply proposals**: NO in V1. Richiede ulteriore design (rollback, sandbox testing).
- **Cross-LLM/cross-environment**: V1 funziona solo in Claude Code (legge log PowerShell hook). Cross-LLM richiede unificazione log format.
- **ML-based pattern detection**: V1 usa heuristic semplici. ML avrà sense solo dopo 6+ mesi di log aggregati.

## Tracking

- Item 13 backlog AI: `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`
- Design doc: questo file
- Future implementation: tracciato in `todos/active.md` come sprint dedicato
