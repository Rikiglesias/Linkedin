---
name: messaging-rules
paths:
  - "src/workers/messageWorker.ts"
  - "src/workers/messagePrebuildWorker.ts"
  - "src/workers/inboxWorker.ts"
  - "src/workers/chatMessageExtractor.ts"
  - "src/workers/followUpWorker.ts"
  - "src/automation/**"
enforcement:
  - antiban-review skill (raccomandata)
  - pre-edit-antiban.ps1 (blocking)
  - security-reviewer per template injection
---

# Messaging & inbox rules — outbound/inbound LinkedIn

> Path-scoped rule per outbound messaging (invio + follow-up), inbox processing (lettura + reply), prebuilding template.
> Si attiva sui worker messaging-touch e su `src/automation/**` (dispatcher).

## Domini critici

I messaggi LinkedIn sono il punto di **massima esposizione** anti-ban: spam, template detection, reply pattern.

## Regole obbligatorie

1. **No template detection signal**: ogni messaggio deve avere varianza lessicale (spinning), personalizzazione vera dal profilo target (nome, ruolo, azienda, post recenti), no boilerplate identico.
2. **Spacing tra messaggi**: minimo 5-15 min tra invii sullo stesso account, varianza inclusa. No burst.
3. **Reply detection**: se il target ha risposto, mai inviare follow-up automatico senza human review (alert Telegram con context).
4. **No URL diretti nel primo messaggio**: link in messaggio iniziale = trigger spam filter. Solo dopo accept connection + reply.
5. **Lingua coerente**: messaggio in lingua del target (locale profilo LinkedIn), non sempre IT/EN per tutti.
6. **Length distribution**: messaggi variano 80-400 char, no tutti uguali. Pattern length = pattern bot.
7. **Inbox processing**: lettura inbox a intervalli umani (non polling stretto), no mark-read di massa.
8. **Input sanitization**: input dal profilo target o dall'inbox NON inserito in template senza sanitize (XSS in dashboard, log injection).

## Pre-edit check

- Modifichi template messaggio? → varianza + personalizzazione check
- Aggiungi follow-up logic? → reply detection + spacing check
- Tocchi inbox worker? → intervallo umano + no batch mark-read
- Tocchi automation/dispatcher? → spacing tra invii + cap per ora/giorno

## Failure mode

- Identical template inviato a 100 prospect → spam filter LinkedIn → ban
- Follow-up dopo reply manuale → user complaint → restriction
- URL nel primo messaggio → trigger ML detection
- Length-pattern troppo uniforme → fingerprint bot
- Polling inbox ogni 30s → signal non-umano

## Tool consigliati

- `antiban-review` skill per ogni cambio template/timing
- `silent-failure-hunter` post-refactor inbox
- `security-reviewer` su parsing profilo target (XSS, injection)
