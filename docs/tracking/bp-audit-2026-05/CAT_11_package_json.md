## Categoria 11 — `package.json` (npm scripts AI section)

### Fonti best practice consultate (2026)

- [npm docs: scripts](https://docs.npmjs.com/cli/v10/using-npm/scripts/)

### Best practice identificate

Script `package.json` espliciti, componibili, scoperti via `npm run` e con exit code propagato.

### Stato nostro sistema

| Area | Stato | Note |
|---|---|---|
| Quality gate | ✅ | `pre-modifiche`, `post-modifiche`, `conta-problemi` |
| Audit weekly/monthly | ✅ | scripts presenti e usati dai `.bat` |
| Audit control plane | ✅ | aggrega docs/hooks/routing/ADK/L2-L6/list |
| Git automation gate | ✅ | strict commit/push disponibili |

### Gap identificati

| # | Gap | Severity | Evidenza |
|---|---|---|---|
| 1 | `audit:monthly` riesegue `audit:adk-capabilities` gia' incluso in `audit:ai-control-plane` | LOW | duplicazione costo/tempo, non bug |
| 2 | Nessun namespace esplicito `audit:ai:*` separato da audit applicativi | LOW | leggibilita' futura se crescono gli audit |

### Fix applicati in questo turno

- Nessuna modifica a `package.json`: la duplicazione e' low-risk e non blocca il problema reale.

---

