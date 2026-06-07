---
name: antiban-review
description: Analizza una modifica al codice dal punto di vista anti-ban LinkedIn. Risponde alle 6 domande obbligatorie e dà un verdetto. Attivare con /antiban-review o "review anti-ban", "è sicuro per LinkedIn?", "impatto anti-ban".
---

# Anti-Ban Review

## Pre-conditions (quando invocare OBBLIGATORIAMENTE)

Invocare `/antiban-review` PRIMA di qualsiasi modifica che tocca almeno uno di questi pattern:
- File contenenti: `browser`, `playwright`, `stealth`, `fingerprint`, `timing`, `delay`, `session`, `humanDelay`, `inputBlock`, `clickLocator`, `inviteWorker`, `inboxWorker`, `organicContent`, `syncSearch`, `syncList`, `sendInvites`, `sendMessages`
- Qualsiasi modifica a cap, volumi, budget, limiti di invito o messaggi
- Aggiunta di nuove azioni LinkedIn (click, navigazione, typing, scroll)
- Modifica ai proxy, cookie o gestione sessione

Il `PreToolUse` hook in `settings.json` segnala automaticamente i file a rischio — ma la review va comunque eseguita.

**Non invocare** per: modifiche a doc, log, config non-bot, dashboard, test unitari puri senza azioni LinkedIn.

## Post-conditions (cosa verificare dopo la review)

Dopo il verdetto:
- ✅ SICURO → procedi con l'implementazione
- ⚠️ ATTENZIONE → applicare le modifiche indicate, poi ri-verificare prima del commit
- 🔴 BLOCCO → non implementare nulla. Risolvere prima il blocco specifico. Dopo fix → ri-eseguire `/antiban-review`

Documentare il verdetto in commit message: `fix(antiban): [descrizione] — antiban SICURO/ATTENZIONE`

---

Quando l'utente vuole valutare l'impatto anti-ban di una modifica:

## Le 6 domande obbligatorie

Rispondi a ciascuna con ✅ (sicuro) / ⚠️ (attenzione) / 🔴 (blocco):

1. **Browser behavior**: Questa modifica cambia il comportamento del browser su LinkedIn?
2. **Timing/delay**: Cambia timing, delay, ordine delle azioni? La varianza è preservata? I delay sembrano hesitation umana (non pattern matematico fisso)?
3. **Fingerprint/session**: Tocca fingerprint, stealth, cookie, sessione? La coerenza è mantenuta? Si usa IP residenziale (Oxylabs) e non VPN/datacenter?
4. **Nuova azione LinkedIn**: Aggiunge click, navigazione, typing? Usa humanDelay? Nessun `page.goto()` diretto su profili?
5. **Volumi**: Cambia budget, cap, limiti? Il pending ratio resta sotto 65%? Siamo sotto le 80 azioni/giorno?
6. **Behavioral pattern** (nuovo 2026): La sequenza di azioni sembra un essere umano reale? LinkedIn ora usa ML per rilevare il "ritmo" matematico dei bot — pattern lineari (es. esattamente 1 azione ogni N secondi) vengono flaggati. Verificare: shuffle ordine azioni ✓, varianza mood factor ✓, pause irregolari ✓, sessioni max 45min ✓.

## Principi da verificare

- **VARIANZA**: timing non fisso, mood factor ±20%, ordine shufflato — nessun pattern matematico rilevabile
- **SESSIONI**: max 45min browser aperto, pausa pranzo, no weekend, login da IP/device coerenti
- **FINGERPRINT**: PRNG Mulberry32 deterministico, no pattern fissi — LinkedIn traccia behavioral biometrics
- **NAVIGAZIONE**: mai `page.goto()` diretto su profili LinkedIn
- **IP**: solo residenziali (Oxylabs) — VPN e datacenter IP rilevati e flaggati da LinkedIn nel 2026
- **LIMITE GIORNALIERO**: max 80 azioni/giorno — threshold usato da piattaforme anti-ban professionali

## Red flag 2026 (blocco immediato se presente)

- Delay costante o quasi costante tra azioni dello stesso tipo
- Login da IP datacenter o VPN
- Più di 80 azioni/giorno su un singolo account
- Sessione browser aperta >45 minuti consecutivi
- Stesso click pattern ripetuto senza varianza

## Verdetto finale

- ✅ **SICURO** — procedi
- ⚠️ **ATTENZIONE** — procedi con le modifiche indicate
- 🔴 **BLOCCO** — non deployare finché non si risolve [problema specifico]

Se l'utente non ha specificato la modifica, chiedi di descriverla o indicare il file.
