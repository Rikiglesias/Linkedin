# Assistente Digitale per LinkedIn — come funziona il sistema

## In una frase
Un assistente digitale che **trova, qualifica e contatta clienti B2B su LinkedIn in automatico**, comportandosi come una persona reale per non essere mai bloccato.

## Il valore in 4 passi
1. **Trova** — pesca i profili giusti dalle liste e dalle ricerche salvate di LinkedIn Sales Navigator.
2. **Qualifica** — arricchisce ogni contatto (email, dati azienda) e gli assegna un punteggio: chi vale davvero la pena contattare.
3. **Contatta** — invia richieste di collegamento e messaggi di follow-up, personalizzati sul profilo della persona e nella sua lingua.
4. **Monitora** — tiene traccia di chi accetta, chi risponde, e di tutti i numeri, con avvisi in tempo reale su Telegram.

## I 5 workflow del sistema
- **sync-list** — importa nel database una lista già salvata su Sales Navigator, arricchendo i dati e calcolando lo score di ogni lead.
- **sync-search** — estrae in massa i risultati delle ricerche salvate e li raccoglie in una lista, deduplicando i contatti già noti.
- **send-invites** — invia le richieste di collegamento ai lead pronti, con una nota scritta dall'AI calibrata sul profilo.
- **send-messages** — manda il primo messaggio di follow-up a chi ha accettato, iper-personalizzato.
- **autopilot (run-loop)** — il pilota automatico: cicla i controlli, invia, messaggia, arricchisce e manda i report, gestendo pause e ritmi in modo umano.

## La sicurezza: si comporta come un essere umano
LinkedIn blocca i comportamenti "da robot". Questo sistema li evita:
- **Orari e pause realistici** — non lavora di notte, fa pause pranzo, non fa maratone meccaniche.
- **Ritmo sempre variabile** — i tempi tra le azioni non sono mai fissi (distribuzioni caotiche, non "ogni 5 secondi").
- **Digitazione umana** — scrive lettera per lettera, a volte fa un errore di battitura e si corregge.
- **Navigazione naturale** — scorre, legge, muove il mouse come una persona; mai "teletrasporti".
- **Si ferma se rileva rischi** — un motore di rischio valuta in tempo reale e mette in pausa se qualcosa non va.

## Il cervello: intelligenza artificiale
- **Scrive per te** — note di invito e messaggi personalizzati, nella lingua del contatto.
- **Sceglie i migliori** — valuta e dà priorità ai contatti più rilevanti.
- **Vede la pagina** — quando i pulsanti cambiano, "guarda" lo schermo (Vision AI) e capisce dove cliccare.
- **Valuta il rischio e decide** — un guardiano AI può fermare tutto se le condizioni non sono sicure.

## Cosa vedi tu: la dashboard
Un'unica schermata mostra in tempo reale: contatti raggiunti, tasso di accettazione, risposte ottenute, andamento giornaliero, stato del sistema e avvisi. Senza dover capire nulla di tecnico.

## Dove stiamo andando (sviluppo in corso)
- Un **"cervello esterno" supervisore** che osserva il bot mentre opera: veloce nel capire la pagina e gli imprevisti, ma sempre lento e umano nell'agire.
- Modelli di AI più potenti per messaggi e comprensione delle pagine ancora migliori.
- Attenzione costante a **privacy e conformità** (GDPR) nel trattamento dei dati dei contatti.
