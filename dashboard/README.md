# Todo Dashboard — LinkedIn Bot

Dashboard realtime per gestione task, costruita con Next.js + Supabase.

## Setup rapido

### 1. Supabase
1. Vai su [supabase.com](https://supabase.com) → crea un progetto
2. Apri il SQL Editor e incolla il contenuto di `schema.sql`
3. Esegui lo script (crea tabella `todos`, trigger, Realtime)

### 2. Variabili d'ambiente
Copia `.env.example` in `.env.local` e inserisci le credenziali Supabase:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```
Trovi entrambi in Supabase → Settings → API.

### 3. Avvio
```bash
cd dashboard
npm install
npm run dev
```
Apri [http://localhost:3001](http://localhost:3001).

## Funzionalità
- **Realtime**: aggiornamenti istantanei via WebSocket (nessun refresh)
- **Colonne**: Pending / In Progress / Completed
- **Priorità**: High (rosso) / Medium (giallo) / Low (grigio)
- **Agente**: campo opzionale per assegnare la task a un agente AI
- **Dark minimal**: sfondo #0f0f0f, font monospace

## Aggiornamento task da agente AI
Qualsiasi agente con accesso Supabase può aggiornare lo stato:
```js
await supabase.from('todos').update({ status: 'completed' }).eq('id', taskId);
```
Il dashboard si aggiorna in tempo reale senza bisogno di refresh.
