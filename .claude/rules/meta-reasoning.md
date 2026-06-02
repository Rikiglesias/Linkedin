---
name: meta-reasoning
paths:
  - "**"
enforcement:
  - UserPromptSubmit reminder hooks (advisory)
  - documento canonico AGENTS.md (puntatore)
---

# Meta-reasoning rules — interpretazione, verifica, proattività

> Path-scoped rule estratta da AGENTS.md. Attiva sempre (`**`).
> Raccoglie le 11 meta-regole comportamentali sopra ogni P0/L1-L9: come ragionare, come verificare, quando contestare, come gestire fretta vs pazienza, contratti e blast radius.

## 1. Intento non letterale

Ogni prompt va interpretato come farebbe un senior engineer con pieno contesto, non eseguito meccanicamente.

**Regola**: quando il testo dice X ma il contesto suggerisce Y, interpretare Y, dichiararlo e procedere.

**Trigger obbligatori**:
- dettato vocale → interpretare semanticamente, ignorare errori fonetici
- richiesta tecnicamente sbagliata → dichiararlo PRIMA, non dopo
- richiesta che contraddice un canonico o una decisione passata → segnalarlo
- richiesta che potrebbe causare ban → rispondere con domanda zero antiban

**Test di conformità**:
1. "Cancella il file X" ma X è un log critico → dichiarare rischio, chiedere conferma
2. "Disabilita il delay" → rispondere con antiban check, non eseguire
3. "Fai quello di prima" senza contesto → chiedere chiarimento, non inventare

## 2. Fallback context degradation e cambio chat

Quando il context window supera soglia critica o il ragionamento mostra degrado:

**Soglie**:
- ctx >70% → attivare `lean-ctx` MCP, ridurre verbosità
- ctx >85% → proporre cambio chat/continuita' Obsidian prima di compattare
- ctx >95% → fermarsi, compilare continuita', sincronizzare Obsidian, non continuare sullo stesso contesto

**Procedura continuita'** (pre-compattazione / nuova chat):
1. `Grep` caller dei moduli toccati — blast radius reale
2. Aggiornare `todos/active.md` con stato corrente
3. Aggiornare `docs/tracking/ENGINEERING_WORKLOG.md`
4. Aggiornare `C:\Users\albie\memory\` se sono cambiate decisioni, stato o preferenze
5. Compilare `.claude/CONTINUATION.md` senza TODO con problema, completato, decisioni, stato tecnico e prossimo passo
6. Eseguire `node C:\Users\albie\.claude\scripts\sync-memory-to-obsidian.mjs --verbose`
7. Verificare `npm run audit:handoff-staleness`
8. Committare se L1 verde e il blocco e' pronto

`SESSION_HANDOFF.md` e `.claude/SESSION_PROMPT.md` sono fallback legacy/storico: consultarli solo se la continuita' primaria manca o serve confronto storico.

**Segnali di degrado oltre ctx%**: ripetizione di stesse domande già risolte, dimenticanza decisioni della stessa sessione, risposta che ignora constraint dichiarati.

**Fallback tool**: `context-compression` skill, `lean-ctx` MCP, `latent-briefing` skill per multi-agent, `context-handoff` solo se serve rigenerare un pacchetto legacy.

## 3. Best practice per ogni modifica

Ogni modifica al codice deve seguire questo ordine. Nessuna eccezione.

1. **Blast radius prima** — mappare file diretti e indiretti
2. **Contratti** — input/output/side-effect di ogni funzione modificata
3. **Dipendenze** — import, export, caller toccati
4. **Test impattati** — identificare e rieseguire
5. **Nessuna modifica parziale** — tutto o niente, verificato e completo

**Non dichiarare chiuso** se: caller modificato non verificato, test impattato non rieseguito, contratto cambiato non propagato.

**Escalation**: perimetro maggiore del previsto → fermarsi, ridisegnare scope, comunicare.

## 4. Cross-domain per ogni file

Ogni file toccato deve essere valutato su TUTTI i domini, non solo il tema principale.

| Dominio | Domanda |
|---------|---------|
| Sicurezza | Input validato? Auth rispettata? Segreti esposti? |
| Anti-ban | Tocca browser/timing/stealth/LinkedIn? → antiban-review |
| Architettura | Circular deps? SRP rispettata? Contratto pulito? |
| Timing/performance | Timeout? Leak? Busy wait? |
| Compliance | Dati personali? GDPR? Log sensibili? |
| Observability | Log strutturati? Alert dicono cosa fare? |

**Tool**: `antiban-review` (file LinkedIn), `security-reviewer` (auth/input), `silent-failure-hunter` (post-refactor).

**Non è sufficiente** verificare solo il dominio principale della modifica.

## 5. Anti-compiacenza

L'AI deve contestare richieste sbagliate o rischiose PRIMA di eseguirle.

**Quando contestare obbligatoriamente**:
- contraddice canonico o decisione passata
- aumenta rischio ban LinkedIn
- disabilita gate di sicurezza
- assunzione tecnica errata evidente
- richiesta di dichiarare "fatto" senza verifica reale

**Come contestare**:
1. Dichiarare il problema in modo esplicito e motivato
2. Proporre alternativa corretta
3. Procedere solo dopo conferma consapevole dell'utente

**Scenari di test**:
1. "Disabilita il delay tra azioni" → bloccare, antiban check, proporre varianza
2. "Skippa i test, già testato" → dichiarare rischio, non saltare
3. "Push diretto su main" → dichiarare policy, chiedere conferma

**NON è anti-compiacenza**: chiedere conferma su ogni cosa banale. Solo su rischi reali.

## 6. Task multi-categoria — proattività

Quando l'utente dichiara un task con **N categorie/step indipendenti** (es. "audit best practice per 13 categorie", "chiudi tutti gli item del backlog"), procedere **proattivamente** senza chiedere conferma ad ogni step.

**Trigger**: task esplicitamente multi-categoria con lista enumerata + approvazione iniziale + nessun rischio invasivo per categoria.

**Procedura**:
1. Dichiarare la sequenza ("ora categoria N: X")
2. Eseguire la categoria completa (web search + audit + fix + commit)
3. Passare alla successiva senza chiedere "continuo?"
4. Fermarsi SOLO se: context window critico (>80%), errore inaspettato che richiede decisione, modifica strutturale invasiva non prevista, bug/blocker che richiede chiarimento

**Anti-pattern**:
- "Vuoi che continui?" dopo ogni categoria approvata
- Recap intermedio + domanda quando l'approvazione è già data
- Fermare proattività su task ben definito

**Chiedere ancora quando**: categoria cambia scope (audit → refactor invasivo), trade-off architetturale, costo/tempo significativamente sopra stima.

## 7. Pazienza vs fretta

Preferire **lentezza con verifica** a velocità con omissioni. "Aver fatto qualcosa" ≠ "aver fatto qualcosa verificato".

**Rallenta quando**: task ≥3 step (→ `/goal`); 5+ tool call senza recap (→ "verificato X, resta Y, bloccatori Z"); sensazione di "chiudere il turno" (segnale di fretta); risposta finale lunga (esplicitare per ogni file cosa è verificato e cosa saltato).

**Anti-pattern**: tirare via senza verificare diretti+indiretti, "fatto visibile" trattato come "fatto verificato", saltare web search "credo di sapere", risposte cumulative che nascondono step saltati, DONE solo per dimostrare progresso, saltare classificazione temporale.

**Preferire `/goal`**: end state misurabile sopra 3 turn. Esempio: `/goal all audit green and commit pushed or stop after 10 turns`.

**Preferire `/loop`**: task ricorrente con stato che cambia (CI, deploy, queue). Esempio: `/loop 30m npm run audit:miss-metrics`.

**Stop intermedi obbligatori**: dopo ogni 5 tool call → recap 1 riga; prima di commit → enumerare staged e perché.

## 8. Classificazione temporale del task

Per ogni task non banale, dichiarare orizzonte prima di pianificare:

| Orizzonte | Significato | Esempio |
|---|---|---|
| **breve** | Sessione o entro 1 settimana | Bug fix, feature piccola, docs |
| **medio** | 1-4 settimane, multi-sessione | Refactor area, nuovo modulo |
| **lungo** | Mesi, milestone | Riarchitettura, pacchetto |

**Quando obbligatorio**: task multi-file/multi-dominio, dipendenze esterne, backlog con sub-task, manutenzione ricorrente.

**Regole**:
1. Dichiarare orizzonte in 1 riga prima della pianificazione
2. **Non rinviare obblighi brevi nel medio/lungo** — brevi vanno fatti nella sessione o documentati BLOCKED
3. Task medio/lungo → spezzare in milestone con orizzonte breve verificabile
4. Manutenzione ricorrente → cadenza esplicita (`audit:weekly`/`audit:monthly`)

**Anti-pattern**: usare medio/lungo come parcheggio per task chiudibili oggi.

## 9. Blast radius e ordine di esecuzione

1. Mappare file diretti e indiretti (dipendenze, import, contratti, integrazioni)
2. Identificare domini coinvolti: sicurezza, architettura, workflow, automazione, performance, tipi, error handling, docs
3. Stabilire ordine delle modifiche prima di iniziare, per non rompere collegamenti a metà
4. Perimetro grande → code search, mapping dipendenze/test, memoria e agenti esplorativi

## 10. Contratti, stato e propagazione dei fallimenti

- Ogni funzione/modulo/workflow: contratto esplicito (input, output, side effect). Side effect non dichiarati = bug architetturale.
- Stato condiviso da più consumatori: una sola fonte di verità autoritativa. Copie divergenti = bug.
- Fallimenti critici: propagarsi fino al livello che può agire. Swallowing silenzioso = bug operativo. Root cause diverse richiedono recovery diverse.

## 11. Interpretazione degli esempi — ragionamento per pattern

Quando l'utente fornisce esempi come input:

- gli esempi mostrano il TIPO di ragionamento richiesto, non la lista completa dei casi
- identificare il principio sottostante (non il caso specifico)
- decomporre argomento/esempio in albero: sottopunti, sotto-sottopunti, rami correlati
- per ogni ramo rivalutare fonte, web/docs/MCP, skill/capability, rischi, verifiche, done criteria
- applicare il principio a TUTTI i casi analoghi — anche quelli non citati
- se l'utente porta 2 scenari, chiedersi: quanti altri scenari analoghi tocca lo stesso principio?
- non dichiarare concluso un ragionamento limitandosi ai soli esempi forniti
- vale per rischi tecnici, controlli di qualità, pattern documentali e regole operative
