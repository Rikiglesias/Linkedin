/**
 * Generatore di note per gli inviti LinkedIn.
 * Usa template predefiniti variati per evitare pattern ripetitivi.
 * Tutte le note restano sotto i 300 caratteri (limite LinkedIn).
 */

export interface TemplateNoteResult {
    note: string;
    variant: string;
}

const NOTE_TEMPLATES: ReadonlyArray<{ variant: string; render: (firstName: string) => string }> = [
    { variant: 'TPL_CASUAL_INTEREST', render: (n) => `Ciao ${n}, ho trovato il tuo profilo interessante e mi piacerebbe aggiungerti alla mia rete. A presto!` },
    { variant: 'TPL_PROFESSIONAL_FOLLOW', render: (n) => `Ciao ${n}, seguo il tuo lavoro con interesse. Sarebbe un piacere connetterci!` },
    { variant: 'TPL_COMMON_INTERESTS', render: (n) => `Salve ${n}, ho visto il tuo profilo e penso potremmo avere interessi in comune. Ti aggiungo volentieri!` },
    { variant: 'TPL_NETWORK_EXPANSION', render: (n) => `Ciao ${n}, mi piacerebbe connettermi con te per ampliare la mia rete professionale. Buona giornata!` },
    { variant: 'TPL_BACKGROUND_APPRECIATION', render: (n) => `Ciao ${n}, ho apprezzato il tuo background professionale. Sarebbe bello entrare in contatto!` },
    { variant: 'TPL_ATTENTION_GRABBER', render: (n) => `Salve ${n}, il tuo profilo ha attirato la mia attenzione. Ti propongo di connetterci!` },
    { variant: 'TPL_MUTUAL_BENEFIT', render: (n) => `Ciao ${n}, credo che possiamo trarre reciproco beneficio da questa connessione. A presto!` },
    { variant: 'TPL_LIKE_MINDED', render: (n) => `Ciao ${n}, mi farebbe piacere allargare la mia rete con professionisti come te. Collegati con me!` },
];

/**
 * Ritorna una nota di invito personalizzata con il nome del lead e il suo ID variante per A/B Testing.
 * La selezione del template è pseudo-casuale.
 */
export function generateInviteNote(firstName: string): TemplateNoteResult {
    const name = firstName.trim() || 'collega';
    const index = Math.floor(Math.random() * NOTE_TEMPLATES.length);
    const selected = NOTE_TEMPLATES[index];
    return {
        note: selected.render(name),
        variant: selected.variant,
    };
}
