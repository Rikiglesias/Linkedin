## Categoria 9 — TypeScript audit script (`src/scripts/*Audit.ts`)

### Fonti best practice consultate (2026)

- [TypeScript TSConfig `strict`](https://www.typescriptlang.org/tsconfig/strict.html)
- [npm scripts documentation](https://docs.npmjs.com/cli/v10/using-npm/scripts/)

### Best practice identificate

Type checking stretto, script npm dichiarativi, output deterministico, SRP per audit e API strutturate al posto di string command fragili.

### Stato nostro sistema — count verificato L9.8

| Misura | Valore | Evidenza |
|---|---:|---|
| Script `*Audit.ts` | 15 | `src/scripts/*Audit.ts` |
| Script oltre ~300 righe | 5 | `aiControlPlaneAudit`, `aiListCompletenessAudit`, `gitAutomationAudit`, `hooksConformityAudit`, `adkCapabilityGovernanceAudit` |
| Uso `execSync` | 1 | `handoffStalenessAudit.ts` |
| Interfaccia `CheckResult` duplicata | 7+ | pattern ripetuto nei singoli audit |
| Quality gate agganciati a npm | ✅ | `package.json` scripts `audit:*` |

### Gap identificati

| # | Gap | Severity | Evidenza |
|---|---|---|---|
| 1 | Alcuni audit sono diventati moduli monolitici | MEDIUM | 5 file >~300 righe; `aiControlPlaneAudit.ts` 1058 righe |
| 2 | Tipi e helper comuni duplicati | MEDIUM | `CheckResult`, `readFileSafe`, output summary ripetuti |
| 3 | `execSync("git ...")` usa stringa shell invece di argomenti strutturati | LOW/MEDIUM | `handoffStalenessAudit.ts` |
| 4 | Alcuni audit emettono warning ma non exit code non-zero | LOW | scelta consapevole per advisory, ma va dichiarata per ogni audit |

### Fix applicati in questo turno

- Nessun refactor TypeScript applicato: il blast radius e' medio e non serve per chiudere il problema di contesto/handoff corrente.
- Tracciato il refactor corretto: estrarre libreria condivisa `auditCore` per `CheckResult`, path safe read, summary e severity.

### Fix proposti futuri

1. Creare `src/scripts/auditCore.ts` con tipi, helper FS safe, renderer risultati e policy exit code.
2. Spezzare `aiControlPlaneAudit.ts` in audit docs/hooks/routing/list delegati o wrapper compositivo.
3. Sostituire `execSync` string con `spawnSync('git', args, ...)` nei punti dove il comando prende argomenti dinamici.

---

