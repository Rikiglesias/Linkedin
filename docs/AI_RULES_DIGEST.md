# AI_RULES_DIGEST.md

> Indice compatto di TUTTE le regole AI (22 sezioni Spec).
> Non e' fonte primaria — per dettagli leggere canonici completi.

## 3 Momenti
INIZIO (SessionStart): memoria+digest+routing. DURANTE (UserPromptSubmit+Pre/PostToolUse): routing,L1gate,antiban,audit. FINE (Stop): worklog+active.md.

## 9 Livelli
L1 typecheck+lint+test+madge=0 BLOCKING | L2 caller/contratti/test audit | L3 runtime/null/leak audit | L4 double-exec/partial-fail/rollback audit | L5 reachability/alert audit | L6 data-flow/SSOT audit | L7 multi-dominio/file skill | L8 coerenza cross-file skill | L9 loop DONE/BLOCKED skill. Quick=L1-L4. Bug=L1-L6. Feature=L1-L9.

## 22 Regole

### 1. Verita' operativa
Non fingere fatto senza prova. Dichiarare cosa manca. Allucinazione=verifiche non eseguite.

### 2. Intento non letterale
Interpretare semanticamente. Collegare a storia/decisioni/priorita'. Esempi=pattern → inferire controlli.

### 3. Blast radius
Mai file isolato. Mappare blast PRIMA. Ordine deciso prima.

### 4. Best practice per artefatto
Ogni tipo ha le sue. Tecnologia cambia → web/docs ufficiali.

### 5. Fonte di verita'
Stabile→repo/test/canonici. Esterno→docs+web. Reale→MCP. Divergenza=bug.

### 6. Web/docs obbligatori
Framework/API/anti-ban/sicurezza/policy/compliance/recenti. Knowledge obsoleta≠aggiornata.

### 7. Selezione autonoma strumenti
Classificare task PRIMA. Scegliere: skill/MCP/hook/script/web/ambiente. Dichiarare perche'.

### 8. Memoria leggibile
File piccoli/tematici. Ogni file: cosa CONTIENE e NO. Degrado→handoff+nuova sessione.

### 9. Esecuzione intelligente
Classificare tipo. Chiarire: problema/rischio/fonte/strumenti/ordine. Nessuna chiusura senza verifica.

### 10. 9 livelli
Vedi sezione sopra. Proporzionale al task.

### 11. Multi-dominio per file
Ogni file: sicurezza,arch,anti-ban,timing,compliance,performance. Sistematico.

### 12. Loop e lavoro incrementale
Task troppo grande per un passaggio → NON provare tutto insieme. Scomponi in parti, loop su ciascuna, verifica ogni pezzo prima del successivo. Meglio 3 parti verificate che 5 mezze e rotte. /loop per iterazione automatica. Verifica L1-L4 ad ogni giro. Dichiarare cosa manca se non completato al 100%.

### 13. Automazione massima
Scala: chat→canonico→checklist→skill→hook→script/audit→workflow. Dimenticato>1 → promuovere.

### 14. Hook pre/post continuo
Regole critiche=hook non testo. Coprire inizio/azione/post/fine/eventi.

### 15. n8n + agenti
n8n=orchestratore. Workflow riusabili/leggibili. Trigger=contesto reale. HITL per rischio.

### 16. Modello/ambiente
Prompt deboli→chiari. Dire se altro modello/ambiente. Contestuale.

### 17. Commit/push
Commit=chiusura verificata (auto). Push=solo se branch/upstream/rischio OK.

### 18. Pulizia
Analisi reale. Ridurre duplicati/morti/ambigui/caos. File>300 righe→split.

### 19. Nuovi progetti
Checklist bootstrap: setup/gate/tooling/memoria/ambienti/sicurezza/handoff/manutenzione.

### 20. Strumenti personali
Whisper stabile. Codex quando ha senso. Problemi→tracciare+risolvere.

### 21. Obiettivo finale
Utente≠PM tecnico. AI sceglie tutto. Dice verita'. Si ferma. Chiude o dichiara blocco.

### 22. Orizzonti temporali
BREVE=ora. MEDIO=stessa iniziativa. LUNGO=manutenzione. Non rimandare breve→lungo.

## Anti-Ban LinkedIn
Varianza su tutto | Sessioni credibili | Pending ratio | Navigazione umana | Biometrics: hesitation non delay precisi

## Domini + Source
anti-ban→repo | stato→MCP | librerie→web | browser→playwright | DB→Supabase | git→audit | memoria→files | n8n→live | debug→repo | test→vitest | review→diff | codice→search
