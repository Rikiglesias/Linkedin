## Categoria 12 — `.gitignore` (AI/runtime section)

### Fonti best practice consultate (2026)

- [Git manual: gitignore](https://git-scm.com/docs/gitignore)

### Best practice identificate

Pattern generati e condivisi nel repo vanno in `.gitignore`; file personali restano in exclude locale; `.gitignore` non rimuove file gia' tracciati.

### Stato nostro sistema

| Area | Stato | Note |
|---|---|---|
| Runtime DB/session | ✅ | `data/*.sqlite`, `data/session*`, backup |
| Secrets | ✅ | `.env`, key material, credenziali cloud |
| Tool AI locali | ✅ | `.claude/*` con allowlist rules/plugin/output styles |
| Restore drill | ✅ fixato | `data/restore-drill/` ora ignorato |

### Fix applicati in questo turno

- ✅ Aggiunto `data/restore-drill/` sotto Runtime data. Motivo: `git status` generava warning `Permission denied` su directory generata/local-only.
- ✅ Verificato con `git check-ignore -v data/restore-drill/`.

### Gap residui

- Nessun gap bloccante. Resta da mantenere esplicita la allowlist `.claude/` per evitare di committare stato locale Claude.

---

