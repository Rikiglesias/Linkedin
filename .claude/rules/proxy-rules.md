---
name: proxy-rules
paths:
  - "src/proxy/**"
enforcement:
  - antiban-review skill (raccomandata)
  - pre-edit-antiban.ps1 (blocking)
  - audit:mcp-config (relativo)
---

# Proxy rules — residential vs DC, stickiness, fingerprint coherence

> Path-scoped rule per il modulo proxy del LinkedIn bot.
> Si attiva su `src/proxy/**`.

## Domini critici

Il proxy è il primo signal che LinkedIn vede. Datacenter IP, IP reputation, geo mismatch = ban quasi sicuro.

## Regole obbligatorie

1. **Residential per account active**: account in operazione attiva = proxy residential (Oxylabs, Bright Data o equivalente). Mai DC IP.
2. **Stickiness per session**: stesso proxy per tutta la durata della session (login → action → logout). Mai rotation in mezzo a action sequence.
3. **Geo coherence**: paese proxy = paese profilo LinkedIn = lingua browser = timezone. Mismatch = signal evidente.
4. **IP reputation check pre-session**: `ipReputationChecker` deve girare prima di ogni session start. IP flaggato → skip + alert.
5. **JA3 fingerprint**: il TLS fingerprint del client deve essere coerente con UA dichiarato (`ja3Validator`).
6. **Rotation policy**: rotation tra sessions, non dentro. Cooldown minimo tra session sullo stesso IP per evitare burn.
7. **Credenziali proxy**: mai in plain text, mai loggate, mai committate. Solo via env vars o secret store.
8. **Failure → no fallback su IP diretto**: se proxy fallisce, halt session + alert. Mai bypass su IP reale = de-anonimizzazione totale.

## Pre-edit check

- Modifichi proxy selection? → check residential default + geo coherence
- Tocchi rotation logic? → no rotation mid-session
- Cambi credential handling? → no plain text, no log
- Modifichi fallback? → NO fallback su IP diretto (regola dura)

## Failure mode da prevenire

- DC IP usato per account active (ban immediato)
- Rotation mid-session (sessione invalida, login challenge)
- Geo mismatch IT proxy + US profilo (detection)
- IP burnt riutilizzato (ban a catena)
- Credential leak in log/error

## Tool consigliati

- `antiban-review` skill per ogni cambio proxy logic
- `audit:mcp-config` per verifica config proxy
- `security-reviewer` su credential handling
