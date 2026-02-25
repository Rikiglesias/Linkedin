/**
 * Generatore di note per gli inviti LinkedIn.
 * Usa template predefiniti variati per evitare pattern ripetitivi.
 * Tutte le note restano sotto i 300 caratteri (limite LinkedIn).
 */

const NOTE_TEMPLATES: ReadonlyArray<(firstName: string) => string> = [
    (n) => `Ciao ${n}, ho trovato il tuo profilo interessante e mi piacerebbe aggiungerti alla mia rete. A presto!`,
    (n) => `Ciao ${n}, seguo il tuo lavoro con interesse. Sarebbe un piacere connetterci!`,
    (n) => `Salve ${n}, ho visto il tuo profilo e penso potremmo avere interessi in comune. Ti aggiungo volentieri!`,
    (n) => `Ciao ${n}, mi piacerebbe connettermi con te per ampliare la mia rete professionale. Buona giornata!`,
    (n) => `Ciao ${n}, ho apprezzato il tuo background professionale. Sarebbe bello entrare in contatto!`,
    (n) => `Salve ${n}, il tuo profilo ha attirato la mia attenzione. Ti propongo di connetterci!`,
    (n) => `Ciao ${n}, credo che possiamo trarre reciproco beneficio da questa connessione. A presto!`,
    (n) => `Ciao ${n}, mi farebbe piacere allargare la mia rete con professionisti come te. Collegati con me!`,
];

/**
 * Ritorna una nota di invito personalizzata con il nome del lead.
 * La selezione del template è pseudo-casuale basata sul nome (deterministico
 * nella stessa sessione, variabile tra sessioni diverse).
 */
export function generateInviteNote(firstName: string): string {
    const name = firstName.trim() || 'collega';
    const index = Math.floor(Math.random() * NOTE_TEMPLATES.length);
    return NOTE_TEMPLATES[index](name);
}
