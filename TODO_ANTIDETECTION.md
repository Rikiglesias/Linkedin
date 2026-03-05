# TODO_ANTIDETECTION.md - Priorità Stealth & Anti-Ban

Questo documento contiene la lista dei task implementativi per l'anti-detection avanzata, ordinati per priorità. Si basa sull'analisi a 360° del sistema.

## 🔴 PRIORITÀ ALTA (Interventi Critici)

| ID | Task | Componente | Criteri di Accettazione | Stato |
| :--- | :--- | :--- | :--- | :--- |
| AD-01 | **Mouse State Memory** | `humanBehavior.ts` | Il cursore del mouse deve ripartire dall'ultima coordinata conosciuta (no teleporting). Implementare un tracking globale dello stato del mouse per la sessione Page attiva. | `✅ COMPLETO` |
| AD-02 | **Interazioni Organiche Feedback** | `decoyActions` | 15-25% di probabilità di interagire organicamente nel feed (Like, 'Celebrate', 'Insightful', apertura thread commenti). | `✅ COMPLETO` |
| AD-03 | **Hover pre-click (80% ratio)** | `humanBehavior.ts` | Prima di eseguire un click, simulare una pausa di hover (300-800ms) sull'elemento target, con micro-correzioni e una curva di decelerazione realistica. | `✅ COMPLETO` |

---

## 🟠 PRIORITÀ MEDIA (Interventi Strutturali)

| ID | Task | Componente | Criteri di Accettazione | Stato |
| :--- | :--- | :--- | :--- | :--- |
| AD-04 | **Tab Focus/Blur Simulation** | `humanBehavior.ts` | Integrare Page Visibility API mocking: simulare la perdita di focus della tab (utente cambia scheda) per periodi random (3s-45s) durante attese lunghe o lettura. | `✅ COMPLETO` |
| AD-05 | **Hardware Mocks Aggiuntivi** | `stealthScripts.ts` | Mocking realistico di `navigator.deviceMemory` (es. 8) e `screen.colorDepth`/`pixelDepth` (es. 24), per allinearsi al profilo generato. | `✅ COMPLETO` |
| AD-06 | **Canvas Noise Bidirezionale** | `stealthScripts.ts` | Il noise vettoriale del Canvas non deve essere sempre additivo. Modificare script per aggiungere o sottrarre randomicamente pixel (es. variazioni in range -2, +2) per canale RGB. | `✅ COMPLETO` |
| AD-07 | **Battery Drain Simulation** | `stealthScripts.ts` | Simulare un lieve decremento della batteria nel tempo per le lunghe sessioni (es. -1% ogni 10-15 minuti) + stato "discharging" per profili laptop/mobile. | `✅ COMPLETO` |
| AD-08 | **IndexedDB / LocalStorage Mock** | `stealthScripts.ts` | Lasciare tracce storage fittizie ma coerenti (es. key-value di utility o feature flags) per simulare un fingerprinting persistente da parte di analytics di terza parte. | `✅ COMPLETO` |

---

## 🟡 PRIORITÀ BASSA (Miglioramenti Marginali)

| ID | Task | Componente | Criteri di Accettazione | Stato |
| :--- | :--- | :--- | :--- | :--- |
| AD-09 | **Correlazione Device ↔ WebGL** | `deviceProfile.ts` | Il renderer WebGL deve matchare il device. Se profilo iPhone -> Apple GPU, se PC generico -> Intel/NVIDIA coerente. Togliere "Intel Iris Xe" hardcoded. | `✅ COMPLETO` |
| AD-10 | **Variazione Pattern Decoy** | `humanBehavior.ts` | Search terms decoy personalizzati (basati sul ruolo del lead, non generici). Introdotta la possibilità di fare `history.back()` organico (navigazione ondivaga). | `✅ COMPLETO` |
| AD-11 | **Keystroke Timing Bimodale** | `humanBehavior.ts` | Distribuzione bimodale del keystroke: veloce su caratteri continui, pausa più lunga (150ms-300ms) tra parole o cambi semantici. Evitare intervallo puro 40-190ms uniforme. | `✅ COMPLETO` |
| AD-12 | **DNS-over-HTTPS (DoH)** | `proxyManager.ts` | Forzare Chromium a usare server DoH specifici (es. Cloudflare 1.1.1.1 o Google) per bypassare leak DNS a livello ISP. | `✅ COMPLETO` |

---

## 🛡️ RATE LIMITING SAFE (Parametri di Default Obbligatori)

Per mantenere il sistema "Radar Evasion", questi devono essere i limiti operativi base fino a storico maturato:

- **Weekly Invites:** Max 80-90 a regime. **ATTUALE:** `weeklyInviteCap`
- **Daily Invites:** Max 30-40 (evitare soft-cap 50+ non documentato di LinkedIn).
- **Daily Messages:** Max 20-30 per account fresco.
- **Intervallo Inoltro:** Minimo 3-5 minuti intra-job (garantisce anti-burst robusto).
- **Ramp-Up Reale:** Progressivo lungo 3-4 settimane. Settimana 1: 5-8 inviti/gg.

Tutti i rate limit e policy anti-burst attuali sono già su un'ottima struttura architetturale (9/10), è richiesta unicamente la revisione dei parametri `.env` di default.

---
Il presente documento sostituisce il completatissimo e ormai storico `TODOLISTA_360.md` aggiornato al 2026.
