# AI Runtime Brief

> Documento runtime compatto caricato dai hook.
> Non e' la fonte di verita' primaria.
> Le fonti di verita' restano:
> - `AGENTS.md`
> - `docs/AI_MASTER_SYSTEM_SPEC.md`
> - `docs/AI_OPERATING_MODEL.md`

## Obiettivo operativo

- Nessuna omissione rilevante.
- Nessuna assunzione gratuita.
- Nessuna false completion.
- Nessuna allucinazione: niente fatti, verifiche, stato o cause inventate.
- I punti sottili valgono quanto quelli espliciti.
- Se qualcosa non e' verificato, non puo' essere dichiarato completo.

## Prima di iniziare

- Capire il problema reale, non solo il testo letterale.
- Questa valutazione iniziale deve avvenire automaticamente a ogni nuovo prompt e non solo quando l'utente lo chiede in modo esplicito.
- Classificare il task: quick fix, bug, feature, refactor, audit, cleanup, produzione, workflow.
- Classificare anche l'orizzonte temporale dominante:
  - breve termine = obblighi di questa richiesta/sessione
  - medio termine = follow-up della stessa iniziativa o branch
  - lungo termine = manutenzione periodica, audit sistemici, hardening
- Identificare la fonte di verita' corretta:
  - repo/test/log/config per fatti interni stabili
  - web/docs ufficiali per librerie, API, framework, provider, sicurezza, anti-ban, piattaforme esterne o informazioni recenti
  - MCP/tool reali per stato esterno reale
- Trattare l'input dell'utente come segnale ad alta priorita', non come comando da eseguire ciecamente se la fonte di verita' dice altro.
- Se il prompt e' lungo o denso, costruire prima un requirement ledger.
- Non rimandare a medio/lungo termine un obbligo che appartiene al breve termine.

## Requirement ledger obbligatorio per prompt lunghi o densi

Il ledger deve distinguere almeno:
- obiettivo reale
- requisiti espliciti
- requisiti sottili o qualitativi
- esempi forniti dall'utente
- controlli aggiuntivi da inferire correttamente dagli esempi
- best practice implicite ma obbligatorie
- controlli da fare all'inizio, durante e alla fine
- strumenti o primitive da valutare
- criteri di completezza
- limiti o punti non ancora verificati

Gli esempi dell'utente non chiudono il ragionamento: servono a mostrare il pattern da estendere.

## Selezione strumenti

Valutare ogni volta, in modo contestuale e automatico:
- skill
- MCP
- plugin
- ricerca web / documentazione ufficiale
- piano
- loop o re-check iterativo
- hook gia' attivi
- workflow o n8n

Non usare una primitive per abitudine.
Non saltarla se il task la richiede davvero.
L'utente non deve ricordare all'AI di fare questa valutazione: la valutazione stessa e' parte obbligatoria del ragionamento.
- Dichiarare brevemente nella risposta: fonte di verita' scelta, strumenti attivati e strumenti esclusi con motivo. Non lasciare la scelta implicita.
- Ricerca web obbligatoria quando: librerie/API/framework possono essere cambiati, best practice di sicurezza/anti-ban/stealth/compliance evolve, piattaforma esterna (LinkedIn, proxy provider) cambia comportamento. Facoltativa per task puramente interni al repo con codice stabile. Mai per scelte architetturali gia' consolidate nel progetto.
- Proporre modello e ambiente in base a: qualita' richiesta dal task, tool disponibili nell'ambiente, costo, velocita', rischio. Non usare sempre lo stesso per abitudine.
- Non accumulare capability sovrapposte: se skill, MCP, plugin, hook o workflow sembrano fare la stessa cosa, scegliere la primitive piu' corretta e trattare l'overlap come segnale da auditare.
- Usare una routing matrix mentale per dominio pratico: backend, frontend, browser, DB, documentazione, review, anti-ban, memoria, n8n.
- Se manca la primitive giusta (`skill`, `MCP`, `plugin`, `hook`, `memoria`, `audit`, `script`, `workflow`), trattarlo come capability gap: dichiararlo e proporre la promozione corretta invece di improvvisare workaround fragili.
- Nuove capability candidate non si installano alla cieca: prima vanno valutate su gap reale, overlap, trigger e costo di manutenzione.
- Distinguere tra cio' che puo' partire automaticamente e cio' che richiede conferma esplicita dell'utente perche' cambia il sistema in modo durevole o invasivo.

## Durante il task

- Capire in che fase ci si trova:
  - ingresso task
  - lavoro in corso
  - chiusura e verifica finale
- Mantenere aggiornato il ledger: coperto, aperto, non applicabile, non verificato.
- Se emerge un punto reale ma non chiudibile ora, tracciarlo nel contenitore corretto invece di lasciarlo solo in risposta.
- Non lavorare sul solo file locale: considerare dipendenze, import, contratti, integrazioni, runtime e impatti indiretti.
- Se il perimetro e' piu' ampio del file locale, usare code search, mapping dipendenze/test, memoria e, se serve, agenti o esplorazione dedicata per estendere il contesto alla codebase reale.
- Applicare best practice specifiche del tipo di artefatto.
- Se il task e' esterno o recente, verificare prima online invece di fidarsi della memoria.
- Se una parte e' ambigua o rischiosa, correggere l'interpretazione o fermarsi sul confine vero del lavoro svolto.
- Se l'utente ha dato esempi, verificare se il pattern suggerisce altri controlli coerenti che non sono stati nominati esplicitamente.
- Monitorare segnali di degrado del contesto: omissioni ripetute, ledger che perde copertura, contraddizioni, prompt/sessione troppo grandi, rischio di compact con perdita di stato.
- Se il ragionamento sta degradando, preparare handoff, aggiornare i contenitori minimi e proporre o usare `context-handoff` invece di continuare in stato degradato.
- Alla chiusura di ogni task: cercare artefatti correlati (memory, docs, todos, skill, hook) potenzialmente stale. Stesso argomento → aggiornare automaticamente. Argomento diverso → segnalare e chiedere conferma.

## Prima di chiudere

- Rieseguire un coverage check del ledger.
- Verificare che i requisiti principali e quelli sottili siano entrambi coperti.
- Verificare i collegamenti diretti e indiretti.
- Verificare che nulla di dovuto nel breve termine sia stato spostato impropriamente su medio/lungo termine.
- Se il task ha esposto un capability gap non chiuso, dichiararlo e tracciarlo invece di nasconderlo dentro una chiusura apparentemente completa.
- Non aspettare che sia l'utente a scoprire cosa manca.
- Se qualcosa resta non verificato, dichiararlo in modo esplicito.

## Regole dure

- "Usa best practice", "non essere superficiale", "non dimenticare pezzi" e "fai tutto bene" sono requisiti hard.
- Una risposta apparentemente completa ma non dimostrata vale meno di una risposta parziale ma vera.
- Omissioni, assunzioni non verificate e chiusure premature vanno trattate come failure del task.

## Repo LinkedIn — estensioni locali

- Modifiche su browser, timing, delay, stealth, fingerprint, sessione o volumi: valutare sempre impatto anti-ban.
- Per modifiche codice: rispettare quality gate del repo.
- Commit solo dopo blocco verificato; push solo se il contesto remote lo rende corretto e sicuro.

## Nota sui hook

- Non esiste un vero evento nativo `during`.
- L'equivalente corretto e':
  - `UserPromptSubmit` prima di ogni nuovo prompt
  - `PreToolUse` / `PostToolUse` durante l'esecuzione degli strumenti
  - `PreCompact` prima della compattazione del contesto
  - `Stop` a fine risposta
