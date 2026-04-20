# New Project Bootstrap Checklist

Checklist 360 gradi da usare quando nasce un progetto nuovo o quando un progetto esistente va portato a una baseline piu' solida.

Serve per:
- non dimenticare pezzi critici all'inizio
- prevenire debito tecnico evitabile
- allineare codice, documentazione, AI tooling e workflow
- poter passare il progetto anche ad altre persone con meno ambiguita'

Usare questa checklist come documento vivo. Non serve spuntare tutto il primo giorno, ma serve sapere cosa e' gia' coperto, cosa manca e cosa e' bloccante prima di crescere.

## Fase 1 — Baseline minima prima di sviluppare davvero

- [ ] Obiettivo del progetto scritto in modo chiaro: cosa fa, cosa non fa, utente target, confini.
- [ ] Dominio di rischio principale identificato: sicurezza, privacy, anti-ban, compliance, finanza, dati sensibili, affidabilita', costi, reputazione.
- [ ] Stack tecnico e package manager decisi in modo esplicito.
- [ ] Struttura iniziale delle cartelle progettata con responsabilita' chiare.
- [ ] Convenzioni minime fissate: naming, moduli, config, test, logging, error handling.
- [ ] `README.md` creato come punto di ingresso tecnico.
- [ ] `AGENTS.md` creato o adattato con regole operative del progetto.
- [ ] File di backlog e tracking creati: priorita', worklog, handoff.
- [ ] File di contesto progettati bene: regole, fatti stabili, stato sessione, decisioni.
- [ ] Strategia memoria AI definita: cosa salvare, dove salvarlo, cosa non duplicare.
- [ ] Baseline ambienti definita: IDE, terminali, CLI, agenti, skill, hook, MCP, permessi.
- [ ] `.gitignore`, `.env.example` e policy segreti iniziali sistemati.
- [ ] Script minimi di qualita' disponibili: build, lint, typecheck, test o equivalenti.

## Fase 2 — Prevenzione tecnica prima che il progetto cresca

- [ ] Confini tra moduli decisi per evitare file omnibus e dipendenze circolari.
- [ ] Contratti interni chiariti: API, tipi, eventi, DTO, schema config, schema DB.
- [ ] Validazione degli input e dei config prevista in modo esplicito.
- [ ] Strategia error handling definita: errori utente, errori tecnici, retry, fallback, timeout.
- [ ] Logging e osservabilita' minima previsti fin dall'inizio.
- [ ] Regole per i test definite: cosa richiede unit test, integration test, e2e o smoke test.
- [ ] Quality gates decisi: cosa deve passare prima di dichiarare una modifica finita.
- [ ] Strategia per dipendenze esterne e aggiornamenti fissata.
- [ ] Policy per migrazioni, dati persistenti e rollback definita se il progetto ha stato.
- [ ] Policy per feature flag, kill switch o rollback rapido prevista dove il rischio lo richiede.
- [ ] Checklist dei rischi di dominio creata: es. anti-ban, security, compliance, privacy, costi API, quota, rate limit.

## Fase 3 — Layer AI, agenti e affidabilita'

- [ ] Stabilire quali ambienti AI sono supportati davvero: Codex, Claude Code, Cursor, Windsurf, Trae o altri.
- [ ] Definire per ogni ambiente cosa legge, cosa puo' fare e quali limiti ha.
- [ ] Allineare skill, hook, MCP, memorie, slash commands e workflow tra ambienti dove possibile.
- [ ] Se una capability manca in un ambiente, progettare un equivalente ragionevole.
- [ ] Definire una policy di **automation-first fino al confine di sicurezza**: automatizzare tutto cio' che e' ripetibile e verificabile; lasciare con conferma esplicita solo cio' che e' invasivo, distruttivo o ad alto rischio.
- [ ] Definire una regola di orchestrazione cognitiva contestuale valida in ogni ambiente: niente flusso fisso identico per tutto, ma riconoscimento del caso e scelta delle regole pertinenti.
- [ ] L'agente deve capire l'intento reale, non leggere la richiesta in modo solo letterale.
- [ ] L'agente deve classificare task, rischio, fonte di verita' primaria e strumenti possibili.
- [ ] L'agente deve spiegare in modo breve all'utente cosa propone di usare e perche': web/docs, skill, MCP, hook, script, loop, workflow.
- [ ] Se l'ambiente offre un loop nativo, l'agente deve saper riconoscere quando usarlo; se non lo offre, deve proporre l'equivalente corretto quando serve davvero.
- [ ] Prima del DONE, l'agente deve applicare il livello di verifica adeguato al caso, non saltarlo e non gonfiarlo inutilmente.
- [ ] Definire una scala di promozione dei passaggi ricorrenti: chat -> file canonico -> checklist -> skill -> hook -> script/audit -> workflow persistente.
- [ ] Stabilire la soglia di promozione: se un passaggio viene dimenticato o ri-spiegato piu' di una volta, deve salire di livello nella scala di automazione.
- [ ] Elencare i controlli che non devono mai dipendere da una dimenticanza dell'AI: lettura regole canoniche, scelta fonte di verita', quality gate, verifica finale adeguata al caso.
- [ ] Elencare invece le primitive che vanno decise caso per caso con ragionamento esplicito: loop, MCP specifici, workflow, agenti, ricerca web non ovvia.
- [ ] Separare memoria procedurale, semantica ed episodica.
- [ ] Progettare i file di contesto per lettura AI affidabile: indice, file piccoli, sezioni stabili, niente dump monolitici.
- [ ] Definire retrieval/file search sui file canonici quando il contesto cresce.
- [ ] Per i workflow critici usare checklist obbligatorie o output strutturati, non solo prompt liberi.
- [ ] Trasformare i passaggi dimenticati spesso in hook, workflow o automazioni, non in promemoria manuali.
- [ ] Prevedere eval o review periodiche del comportamento degli agenti.

## Fase 4 — Workflow operativo e collaborazione

- [ ] Definire come nasce un task, come viene classificato e come viene chiuso.
- [ ] Stabilire quando serve planning, quando basta quick fix, quando serve review profonda.
- [ ] Definire i file canonici che tutti devono leggere prima di modificare il progetto.
- [ ] Rendere esplicito quando la fonte di verita' e' il repo locale e quando invece web/docs ufficiali o MCP diventano obbligatori prima di modificare.
- [ ] Rendere esplicito quando una regola deve stare in un file canonico, quando va trasformata in hook e quando va trasformata in skill o workflow.
- [ ] Rendere esplicito cosa il sistema deve fare in automatico senza essere chiesto e cosa invece richiede sempre una conferma umana.
- [ ] Preparare handoff semplice per altre persone: stato, rischi, file canonici, runbook, ambienti.
- [ ] Preparare checklist di onboarding per nuovi collaboratori o nuovi agenti.
- [ ] Separare chiaramente documenti canonici, documenti operativi, storico e archivio.
- [ ] Evitare root sporca o documentazione duplicata fin dall'inizio.

## Fase 5 — Produzione, manutenzione e lungo termine

- [ ] Definire cosa significa "production ready" per quel progetto.
- [ ] Definire monitoraggio, alert e segnali minimi di salute.
- [ ] Definire audit periodici: regole, skill, workflow, sicurezza, dipendenze, cleanup.
- [ ] Stabilire come si misura il drift tra ambienti, tra documenti e tra workflow.
- [ ] Stabilire come si aggiornano le regole senza creare contraddizioni o duplicati.
- [ ] Stabilire come si archiviano vecchie decisioni o backlog storici.
- [ ] Verificare che ogni modifica regga nel tempo e non lasci componenti indietro.
- [ ] Verificare che il progetto possa essere riusato come template o passato ad altri senza dipendere da conoscenza implicita.

## Deliverable minimi consigliati

Un progetto nuovo, per essere considerato ben impostato, dovrebbe avere almeno:

- [ ] un `README.md` chiaro
- [ ] un `AGENTS.md` coerente
- [ ] un backlog vivo
- [ ] un worklog o tracking tecnico
- [ ] file di contesto AI progettati bene
- [ ] quality gates minimi eseguibili
- [ ] baseline ambienti/CLI/IDE chiarita
- [ ] policy per rischi principali del dominio
- [ ] strategia test e verifica minima
- [ ] handoff iniziale possibile anche per un'altra persona

## Regola finale

Se una prevenzione e' economica da fare all'inizio, conviene quasi sempre farla prima che il progetto cresca.
La checklist non serve a rallentare: serve a evitare che il progetto diventi fragile, opaco e costoso da rimettere in ordine dopo.
