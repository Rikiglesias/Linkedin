# Guida Operativa ai Workflow

> Stato documento: guida operativa e orientata all'uso dei workflow.
> Per il contratto tecnico del motore usare `WORKFLOW_ENGINE.md`.
> Per il deep dive architetturale usare `WORKFLOW_ANALYSIS.md`.

Benvenuto nella documentazione dei **Workflow del Bot LinkedIn**. Questa guida è pensata per spiegarti come operano i 5 flussi principali, cosa chiedono, come ti proteggono e cosa generano.

Se stai cercando il modo migliore per estrarre lead, scaldarli e inviare messaggi personalizzati, sei nel posto giusto.

---

## I 5 Workflow Principali

Il sistema è diviso in 4 workflow **manuali** e 1 workflow **automatico** (il run-loop). I workflow manuali ti guidano passo-passo con domande interattive e controlli di sicurezza (il "Preflight").

### 1. `sync-list` (Estrai da una Lista)
**Cosa fa:** Prende una lista che hai già creato e salvato su Sales Navigator e ne importa tutti i profili nel tuo database locale, arricchendoli con email e calcolando uno score.
- **Come si lancia:** `.\bot.ps1 sync-list`
- **Cosa ti chiede:**
  1. Qual è il nome della lista Sales Navigator da cui vuoi pescare?
  2. Quante pagine massimo vuoi scansionare?
  3. Qual è il limite di lead da estrarre?
  4. Vuoi usare l'arricchimento dati per trovare le email?
- **Cosa succede dietro le quinte:** Il bot apre il browser invisibile o visibile, scorre SalesNav come un umano, supera i blocchi modali e salva nome, qualifica e località. Finito lo scraping su LinkedIn, esegue l'arricchimento contattando API esterne (Apollo/Hunter) per trovare l'email e usa l'AI (OpenAI) per dare un voto (score) al prospect basandosi sul suo titolo di lavoro.
- **Risultato:** Ti ritrovi i lead pronti per essere invitati (status `READY_INVITE`).

### 2. `sync-search` (Estrai da Ricerche Salvate)
**Cosa fa:** Estrae in massa i risultati delle tue *Ricerche Salvate* di Sales Navigator e li butta in una nuova lista, per poi fare il sync e l'enrichment. Perfetto per pescare a strascico.
- **Come si lancia:** `.\bot.ps1 sync-search`
- **Cosa ti chiede:**
  1. Quale ricerca salvata vuoi usare? (Se lasci vuoto, le fa tutte).
  2. In quale lista vuoi salvare i risultati?
  3. Quante pagine e quanti lead massimo?
  4. Vuoi arricchire i dati?
- **Cosa succede dietro le quinte:** Si muove a due step. Nello **Step 1 (Bulk Save)** naviga le ricerche salvate e seleziona i lead in pagina. Se la pagina cambia o LinkedIn cambia i selettori, si affida a "Vision AI" (fa uno screenshot e fa cliccare a GPT-5.4). Nello **Step 2 (Sync)** richiama le stesse funzioni del `sync-list` sulla lista appena popolata. È resistente ai blocchi e deduplica automaticamente i contatti già salvati!
- **Risultato:** I lead delle ricerche finiscono in una lista SalesNav e nel DB, pronti per essere invitati (status `READY_INVITE`).

### 3. `send-invites` (Invia Inviti)
**Cosa fa:** Pesca i lead pronti (`READY_INVITE`) e invia loro la richiesta di collegamento, scrivendo (se vuoi) una nota generata dall'Intelligenza Artificiale calibrata sul loro profilo.
- **Come si lancia:** `.\bot.ps1 send-invites`
- **Cosa ti chiede:**
  1. Vuoi invitare lead di una lista specifica o tutti?
  2. Come vuoi la nota? Generata dall'AI, da un tuo template fisso, o vuoi mandare l'invito vuoto?
  3. Quale "punteggio minimo" deve avere il lead per meritarsi l'invito?
  4. Quanti inviti vuoi fare in questa sessione? (Il sistema rispetta i limiti di sicurezza).
- **Cosa succede dietro le quinte:** Subito dopo il tuo "Ok", il bot esegue un "Pre-enrichment Parallelo", una chiamata API rapidissima e senza browser per trovare altri dettagli del lead e rendere la nota AI perfetta. Poi applica la "Cronometria Disfasica" (tempi asimmetrici log-normali, non 5 secondi precisi ma tempistiche caotiche e umane) per andare a cliccare "Connect". Digita simulando veri colpi di tastiera e talvolta fa persino un errore (typo) e preme *backspace* per correggersi.
- **Risultato:** I lead passano allo status `INVITED`. Appena accetteranno, il sistema se ne accorgerà e li passerà a `ACCEPTED` / `READY_MESSAGE`.
- **Chicca:** Se scopre che hai 0 lead pronti, ti chiede in automatico se vuoi lanciare un `sync-search` per rimpinguare il database.

### 4. `send-messages` (Invia Messaggi a chi ha accettato)
**Cosa fa:** Trova chi ha accettato il tuo invito (`READY_MESSAGE`) e invia il primo messaggio di follow-up, generato in maniera iper-personalizzata.
- **Come si lancia:** `.\bot.ps1 send-messages`
- **Cosa ti chiede:**
  1. Da quale lista vuoi pescare i contatti?
  2. In che lingua deve scrivere l'AI? (Italiano, Inglese, Francese, Spagnolo, Olandese).
  3. Quanti messaggi vuoi mandare in questa sessione?
- **Cosa succede dietro le quinte:** Proprio come negli inviti, fa un Pre-enrichment per l'AI. Al momento dell'invio valuta una priorità: se trova un "Prebuilt Message" (un messaggio che l'AI ha pre-calcolato la notte scorsa in background, per risparmiare API e secondi preziosi di sessione aperta) usa quello. Se manca, lo genera al volo leggendo bio, qualifica e summary del contatto, e infine applica un check "Anti-Doppione" sul testo prima di scriverlo a mano sulla tastiera.
- **Risultato:** Il lead riceve un messaggio non "da bot" e passa allo status `MESSAGED`. Se risponderà in futuro, andrà in `REPLIED`.

### 5. `run-loop` / `autopilot` (Il Pilota Automatico)
**Cosa fa:** Gira in background. Esegue ciclicamente i controlli, invia gli inviti, manda i messaggi, arricchisce i dati e ti manda il report su Telegram, gestendo pause e ritmi in modo totalmente umanoide.
- **Come si lancia:** `.\bot.ps1 autopilot` (o `.\bot.ps1 run-loop all`)
- **Come funziona:**
  - Controlla se siamo in orario lavorativo (non fa nulla di notte).
  - Aspetta un tempo casuale (fino a 30 minuti) per simulare che ti sei appena seduto alla scrivania.
  - Verifica la tua salute (proxy, cookie, ban).
  - Scansiona chi ha accettato gli inviti e aggiorna il DB.
  - Prepara i messaggi offline.
  - Svolge azioni "distrazione" (scrolla il feed, guarda le notifiche).
  - Esegue gli inviti o messaggi programmati.
  - Fa un backup del database e pulisce i log vecchi.
- **Cosa succede dietro le quinte:** È un vero e proprio "Orchestratore di dipendenze". Non è un cronjob rigido, ma adatta i suoi ritmi in base al giorno: implementa il "Mood Factor" (un giorno fa 35 inviti, il giorno dopo 42, quello dopo 28, mai numeri identici). Suddivide il lavoro in sessioni corte di circa 25 minuti (per non sembrare un bot lasciato acceso) e svolge la *Hygiene*: controlla in background chi non accetta il tuo invito da 30 giorni e ritira silenziosamente le richieste vecchie (per tenere il tuo "Pending Ratio" basso, il KPI numero 1 che LinkedIn usa per bannare le persone). Inoltre, mentre dormi, prepara ("prebuild") i testi dei messaggi che invierà il giorno dopo per risparmiare tempo e far sembrare la scrittura ancora più naturale.

---

## La Magia del "Preflight" (Prima del Volo)

Ogni volta che lanci manualmente i workflow 1, 2, 3 o 4, il bot non parte alla cieca. Entra in modalità **Preflight** e ti mostra una dashboard nella console:

1. **Checklist Anti-Ban Automatica:** 
   Ti chiede se hai chiuso le altre finestre di LinkedIn e controlla da solo quante ore sono passate dall'ultima sessione, avvisandoti se stai agendo troppo in fretta.
2. **Dashboard DB:** 
   Ti mostra quanti lead hai, quanti con email trovate, e come sono divisi per liste.
3. **Stato della Configurazione:** 
   Ti dice chiaramente: "Il proxy è ok? L'AI è accesa? Quanti inviti hai mandato questa settimana? (es. 40/80)".
4. **Valutazione del Rischio (Risk Assessment):**
   Il cuore anti-ban. Calcola un punteggio da 0 a 100 basato sui tuoi pending request, i tuoi errori recenti e le abitudini. Ti darà un semaforo verde `[OK] GO`, un giallo `[!] CAUTION`, o un rosso `[!!!] STOP`. Se è rosso, il bot si rifiuterà di partire per proteggere l'account.
5. **Preview Lead (Novità):**
   Ti fa vedere l'anteprima esatta di chi sta per contattare: "Prossimi 5 lead da invitare: Mario Rossi (CEO), Laura Bianchi (CTO)..." e una stima del tempo che ci metterà (es. "Tempo stimato: ~12 minuti").
6. **Conferma Finale:** "Procedo? [Y/n]". Se dici sì, lui lavora.

---

## Il Ciclo di Vita del tuo Lead (Il "Funnel")

Il bot sposta i tuoi lead tra queste "scatole" in automatico:

1. **`NEW`**: Appena importati da SalesNav.
2. **`READY_INVITE`**: Arricchiti, analizzati e pronti per l'invito.
3. **`INVITED`**: Invito spedito.
4. **`ACCEPTED`**: Ha accettato l'invito.
5. **`READY_MESSAGE`**: Pronto per ricevere il messaggio.
6. **`MESSAGED`**: Messaggio spedito.
7. **`REPLIED`**: Ha risposto. (Qui il bot si ferma e tocca a te subentrare).

*Stati negativi protettivi:* Se il bot non trova l'email o non si fida del profilo lo mette in `SKIPPED`. Se ci sono problemi con l'url lo mette in `BLOCKED`.

---

## Perché il bot è "Paranoico" (E perché devi esserne felice)

LinkedIn banna chi usa l'automazione in modo stupido. Questo bot usa le strategie più avanzate del 2025/2026:
- **Delay Asimmetrici (Cronometria Disfasica):** Non clicca mai "ogni 3 secondi". Finge distrazioni, sbaglia a scrivere e preme `Backspace` per correggere.
- **Rallentamento a Fine Turno (Wind-Down):** Se ha lavorato per 40 minuti, verso la fine inizia a cliccare più lentamente e si distrae di più, come una persona stanca. Quando ha finito, scrolla il feed un po' e chiude la finestra dolcemente.
- **Circuit Breaker per Liste:** Se tenta di invitare 3 persone di una lista e LinkedIn non glielo fa fare, invece di farsi bannare "spegne" quella lista per 4 ore e passa ad altro.
- **Pre-Enrichment e AI:** Il bot arricchisce i dati *prima* di inviare i messaggi. Così l'IA può scrivere "Ho visto che in Apple hai fatto X" invece di un banale "Ciao".

Usa questa guida per sfruttare tutto il potenziale dei workflow senza mai bruciare il tuo account. Buon lavoro!
