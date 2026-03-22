/**
 * salesnav/bulkSaveState.ts — Stato condiviso per il sistema bulk save.
 *
 * Modulo minimo per evitare circular dependency tra bulkSaveOrchestrator
 * e bulkSavePageActions. Entrambi importano da qui senza dipendere l'uno dall'altro.
 */

// Traccia se la lista target è già stata usata in questa sessione di bulk save.
// Dopo il primo save riuscito, skip digitazione nome lista → click diretto (come un umano esperto).
let _bulkSaveListFoundInSession = false;

export function isListFoundInSession(): boolean {
    return _bulkSaveListFoundInSession;
}

export function setListFoundInSession(value: boolean): void {
    _bulkSaveListFoundInSession = value;
}
