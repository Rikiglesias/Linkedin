# Style Guide — Documenti AI-Readable

Questo file definisce le convenzioni per scrivere documenti che un LLM possa leggere, usare e mantenere in modo affidabile.

## Regola zero

Ogni documento deve essere comprensibile da una sessione AI che lo legge per la prima volta senza contesto aggiuntivo.

## Struttura obbligatoria

1. **Titolo**: una riga, dice esattamente di cosa parla il file
2. **Scopo**: 1-2 righe che dicono perche' questo file esiste e quando leggerlo
3. **Contenuto**: organizzato per tema, non per cronologia
4. **Non-goals** (opzionale ma raccomandato): cosa questo file NON contiene e dove trovarlo
5. **Cross-link**: riferimenti espliciti ad altri file correlati (path relativi)

## Un tema per file

- Ogni file tratta UN argomento principale
- Se un file copre piu' di un tema distinto, va spezzato
- Il nome del file deve dire il tema: `AI_RUNTIME_BRIEF.md`, non `notes.md`
- Niente file omnibus (`misc.md`, `various.md`, `notes.md`)

## Limiti di lunghezza

| Tipo documento | Limite suggerito | Azione se superato |
|----------------|-----------------|-------------------|
| Runtime brief | 120 righe / 6000 chars | Compattare o spostare dettagli in file dedicati |
| Memory file | 50 righe | Spezzare per sotto-tema |
| MEMORY.md index | 200 righe | Archiviare entry obsolete |
| Guida operativa | 300 righe | Spezzare in sezioni o file separati |
| Spec / backlog | 500 righe | Accettabile ma verificare densita' |

## Formato

- Markdown standard, niente HTML inline
- Tabelle per dati strutturati (confronti, matrici, lookup)
- Liste puntate per regole operative
- Niente emoji a meno che non servano come marker di stato (e.g. tabelle status)
- Apostrofo ASCII (`'`) invece di apici smart ovunque — evita problemi di encoding

## Summary iniziale

Ogni file >50 righe deve avere un blocco iniziale (dopo il titolo) che dice:
- Cosa contiene
- Quando leggerlo
- Cosa NON contiene (se ambiguo)

## Aggiornamento

- Aggiornare il file quando il suo contenuto cambia, non accumulare appendici
- Se una sezione non e' piu' vera, rimuoverla — non commentarla
- Data di ultimo aggiornamento nel titolo della sezione piu' recente (non nel frontmatter generico)

## Cross-link

- Usare path relativi dal root del progetto: `docs/AI_RUNTIME_BRIEF.md`
- Non usare URL assoluti per file interni
- Se un documento dipende da un altro, dichiararlo esplicitamente nella sezione scopo

## Cosa non contiene questo file

- Convenzioni di codice TypeScript (quelle stanno nelle skill e in CLAUDE.md)
- Regole operative del progetto (stanno in AGENTS.md)
- Struttura della memoria (sta in MEMORY.md e nei frontmatter dei file memory)
