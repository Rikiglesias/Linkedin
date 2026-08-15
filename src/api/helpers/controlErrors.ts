/**
 * Errori delle azioni di controllo runtime (pause/resume/quarantine).
 *
 * Vive in un modulo suo perche' lo lancia `controlActions.ts` e lo mappa `utils.ts`:
 * tenerlo in uno dei due creerebbe un import incrociato fra loro.
 */

/**
 * Una richiesta di ripresa e' stata RIFIUTATA da una protezione attiva.
 *
 * Non e' un errore del server: e' il sistema che tiene fermo il bot apposta. Va servito come
 * 409 col motivo leggibile, non come 500 muto - chi guarda la dashboard deve capire cosa
 * risolvere e come forzare, se davvero vuole.
 */
export class ControlActionRejected extends Error {
    constructor(
        readonly blockedBy: string,
        readonly pauseReason: string | null,
    ) {
        super(
            `Ripresa rifiutata (${blockedBy})` +
                (pauseReason ? `: la pausa in corso e' "${pauseReason}"` : '') +
                '. Risolvi la causa, poi ripeti con force=true se vuoi forzare.',
        );
        this.name = 'ControlActionRejected';
    }
}
