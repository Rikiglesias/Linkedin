---
name: meta-reasoning
paths:
  - "**"
enforcement:
  - UserPromptSubmit reminder hooks (advisory)
  - documento canonico AGENTS.md (puntatore)
---

# Meta-reasoning rules — delta LinkedIn delle regole globali

> Path-scoped (`**`, sempre attiva). Il PRINCIPIO di ogni punto vive nelle regole globali
> `~/.claude/ZERO_RULES.md` (zero-A..P, 16 regole — incl. M verifica-premessa, N checklist-360, O coerenza, P best-practice-retroattiva) e `~/.claude/L_LEVELS.md` (L1-L9), caricate ogni sessione.
> Qui SOLO il **delta specifico-progetto** (anti-ban, continuità, cadenze LinkedIn): non si ri-spiega il globale.
> 11 meta-regole (riferite per nome in `AGENTS.md` — mantenere il count se si modifica).

## 1. Intento non letterale → zero-A + personality #3 (voice)
Delta LinkedIn: richiesta che può causare ban → **domanda zero anti-ban PRIMA** di eseguire.
Test: "disabilita il delay" → antiban check, non eseguire · "cancella X" (log critico) → rischio + conferma.

## 2. Context degradation e cambio chat → preferences + zero-H
Soglia cambio chat: **avviso SOLO >750k token su 1M** (`preferences.md`); sotto, nessun consiglio.
Segnali di degrado oltre i token: domande ripetute, dimenticanza decisioni di sessione, constraint ignorati → handoff.
**Procedura continuità** (pre-nuova-chat/compact): **`/lastchat save`** (scrive `~/.claude/LASTCHAT.md`, sistema UNICO di continuità — 2026-06-07) + aggiorna `~/memory`/`todos/active.md`/`ENGINEERING_WORKLOG.md` se cambiati → commit se L1 verde. CONTINUATION/SESSION_HANDOFF/SESSION_PROMPT + skill resume-context ELIMINATI (vedi `~/memory/decisions_secondo_cervello.md`).

## 3. Best practice per ogni modifica → zero-D + L1/L2
Ordine: blast radius → contratti (input/output/side-effect) → dipendenze/caller → test impattati → niente modifica
parziale. Non dichiarare chiuso se caller/test/contratto non verificati. Perimetro > previsto → ferma, ridisegna scope, comunica.

## 4. Cross-domain per ogni file → L7 + zero-K
Ogni file va valutato su TUTTI i domini, non solo quello principale. Delta LinkedIn: browser/timing/stealth →
`antiban-review`; auth/input → `security-reviewer`; post-refactor → `silent-failure-hunter`.

## 5. Anti-compiacenza → zero-B
Contesta PRIMA di eseguire quando: contraddice canonico/decisione, aumenta rischio ban, disabilita gate sicurezza,
assunzione errata evidente, richiesta di "fatto" senza verifica. Scenari: "disabilita delay" → antiban; "skippa test"
→ no; "push su main" → policy. NON contestare il banale.

## 6. Task multi-categoria — proattività → zero-G + personality #9
Task multi-step approvato → esegui la sequenza senza chiedere "continuo?". Fermati solo su: errore che richiede
decisione, refactor invasivo non previsto, blocker, oppure contesto >750k (vedi §2). Dichiara la sequenza ("ora N: X").

## 7. Pazienza vs fretta → zero-J + zero-C
Lentezza-con-verifica > velocità-con-omissioni. ≥3 step con end-state → `/goal`; task ricorrente con stato (CI/deploy/queue)
→ `/loop`. Recap 1 riga dopo 5 tool call; pre-commit enumera staged + perché. "Fatto visibile" ≠ "fatto verificato".

## 8. Classificazione temporale del task → SPEC §22 + zero-C
breve (sessione/settimana) / medio (branch/milestone) / lungo (periodico). Dichiara l'orizzonte in 1 riga.
**Non rinviare il breve nel medio/lungo.** Cadenze LinkedIn ricorrenti: `audit:weekly` / `audit:monthly`.

## 9. Blast radius e ordine di esecuzione → zero-D + L2
Mappa file diretti + indiretti (dipendenze/import/contratti/integrazioni); identifica i domini coinvolti; stabilisci
l'ordine delle modifiche prima di iniziare; perimetro grande → code-search + mapping test + agenti esplorativi. (Dettaglio operativo di §3.)

## 10. Contratti, stato e propagazione dei fallimenti → L2/L3/L8
Contratto esplicito per ogni funzione/modulo/workflow (side-effect non dichiarati = bug architetturale). Stato condiviso
da più consumatori = 1 sola fonte autoritativa (copie divergenti = bug). Fallimenti critici propagati fino al livello che
può agire; swallowing silenzioso = bug operativo.

## 11. Interpretazione degli esempi — ragionamento per pattern → zero-L
Gli esempi mostrano il TIPO di ragionamento, non la lista chiusa: identifica il principio, decomponi ad albero
(sottopunti/sotto-sottopunti/rami correlati), applica a TUTTI i casi analoghi anche non citati; non concludere sui soli
esempi forniti. Principio globale: **zero-L**; qui l'applicazione dettagliata ad albero per ramo del progetto.
