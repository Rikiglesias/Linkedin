/**
 * ml/locationTimezone.ts
 * Mapping location del lead → offset UTC → delay per inviare durante le ore lavorative del lead.
 * Usa lookup fuzzy sulla stringa location (es. "Milan, Italy" → UTC+1).
 */

// ─── Mapping city/country/region → UTC offset (ore) ─────────────────────────

const TIMEZONE_MAP: ReadonlyArray<{ patterns: RegExp; offsetHours: number }> = [
    // Nord America
    {
        patterns:
            /\b(new york|boston|miami|washington|philadelphia|atlanta|charlotte|orlando|tampa|detroit|pittsburgh|cleveland|cincinnati|nashville|est\b)/i,
        offsetHours: -5,
    },
    {
        patterns:
            /\b(chicago|houston|dallas|austin|san antonio|minneapolis|milwaukee|st\.? louis|kansas city|memphis|new orleans|cst\b)/i,
        offsetHours: -6,
    },
    { patterns: /\b(denver|phoenix|salt lake|albuquerque|el paso|mst\b)/i, offsetHours: -7 },
    {
        patterns: /\b(los angeles|san francisco|seattle|portland|san diego|las vegas|sacramento|pst\b)/i,
        offsetHours: -8,
    },
    { patterns: /\b(anchorage|alaska)/i, offsetHours: -9 },
    { patterns: /\b(honolulu|hawaii)/i, offsetHours: -10 },
    { patterns: /\b(toronto|montreal|ottawa|quebec)/i, offsetHours: -5 },
    { patterns: /\b(vancouver|calgary|edmonton)/i, offsetHours: -7 },
    { patterns: /\b(mexico city|guadalajara|monterrey|m[eé]xico)/i, offsetHours: -6 },
    { patterns: /\b(são paulo|sao paulo|rio de janeiro|brasilia|brasil|brazil)/i, offsetHours: -3 },
    { patterns: /\b(buenos aires|argentina)/i, offsetHours: -3 },
    { patterns: /\b(santiago|chile)/i, offsetHours: -4 },
    { patterns: /\b(bogot[aá]|colombia)/i, offsetHours: -5 },
    { patterns: /\b(lima|per[uú])/i, offsetHours: -5 },

    // Europa Occidentale (UTC+1 CET)
    {
        patterns:
            /\b(milan|rome|roma|naples|napoli|turin|torino|florence|firenze|bologna|genova|palermo|catania|bari|padova|brescia|verona|italia|italy)/i,
        offsetHours: 1,
    },
    {
        patterns: /\b(paris|lyon|marseille|toulouse|nice|nantes|bordeaux|lille|strasbourg|france|francia)/i,
        offsetHours: 1,
    },
    {
        patterns:
            /\b(berlin|munich|m[uü]nchen|hamburg|frankfurt|cologne|k[oö]ln|düsseldorf|stuttgart|dortmund|essen|germany|deutschland|germania)/i,
        offsetHours: 1,
    },
    { patterns: /\b(madrid|barcelona|valencia|sevilla|bilbao|malaga|spain|españa|spagna)/i, offsetHours: 1 },
    { patterns: /\b(amsterdam|rotterdam|den haag|utrecht|netherlands|nederland|olanda|paesi bassi)/i, offsetHours: 1 },
    { patterns: /\b(brussels|bruxelles|antwerp|belgium|belgio|belgique)/i, offsetHours: 1 },
    { patterns: /\b(vienna|wien|austria|graz|linz)/i, offsetHours: 1 },
    { patterns: /\b(zurich|z[uü]rich|geneva|gen[eè]ve|bern|basel|switzerland|svizzera|schweiz)/i, offsetHours: 1 },
    { patterns: /\b(lisbon|lisboa|porto|portugal)/i, offsetHours: 0 },

    // Europa Orientale (UTC+2 EET)
    { patterns: /\b(athens|atene|greece|grecia)/i, offsetHours: 2 },
    { patterns: /\b(helsinki|finland|finlandia)/i, offsetHours: 2 },
    { patterns: /\b(bucharest|romania)/i, offsetHours: 2 },
    { patterns: /\b(warsaw|varsavia|krakow|cracovia|poland|polonia)/i, offsetHours: 1 },
    { patterns: /\b(prague|praga|czech|repubblica ceca)/i, offsetHours: 1 },

    // UK + Irlanda (UTC+0)
    {
        patterns:
            /\b(london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|uk|united kingdom|england|scotland|wales)/i,
        offsetHours: 0,
    },
    { patterns: /\b(dublin|cork|ireland|irlanda)/i, offsetHours: 0 },

    // Medio Oriente
    { patterns: /\b(dubai|abu dhabi|uae|emirati|emirates)/i, offsetHours: 4 },
    { patterns: /\b(riyadh|jeddah|saudi|arabia saudita)/i, offsetHours: 3 },
    { patterns: /\b(tel aviv|jerusalem|israel|israele)/i, offsetHours: 2 },
    { patterns: /\b(istanbul|ankara|turkey|turchia|t[uü]rkiye)/i, offsetHours: 3 },

    // Asia
    { patterns: /\b(mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|pune|kolkata|india)/i, offsetHours: 5.5 },
    { patterns: /\b(singapore|singapo)/i, offsetHours: 8 },
    { patterns: /\b(hong kong)/i, offsetHours: 8 },
    { patterns: /\b(tokyo|osaka|japan|giappone)/i, offsetHours: 9 },
    { patterns: /\b(seoul|south korea|corea)/i, offsetHours: 9 },
    { patterns: /\b(beijing|shanghai|shenzhen|guangzhou|china|cina)/i, offsetHours: 8 },
    { patterns: /\b(bangkok|thailand|tailandia)/i, offsetHours: 7 },
    { patterns: /\b(jakarta|indonesia)/i, offsetHours: 7 },

    // Oceania
    { patterns: /\b(sydney|melbourne|brisbane|perth|adelaide|australia)/i, offsetHours: 10 },
    { patterns: /\b(auckland|wellington|new zealand|nuova zelanda)/i, offsetHours: 12 },

    // Africa
    { patterns: /\b(cairo|egypt|egitto)/i, offsetHours: 2 },
    { patterns: /\b(johannesburg|cape town|south africa|sudafrica)/i, offsetHours: 2 },
    { patterns: /\b(lagos|nigeria)/i, offsetHours: 1 },
    { patterns: /\b(nairobi|kenya)/i, offsetHours: 3 },
];

/**
 * Inferisce l'offset UTC (ore) dalla location del lead.
 * @returns offset in ore (es. -5 per EST, +1 per CET) o null se non riconosciuto
 */
export function inferTimezoneOffset(location: string | null | undefined): number | null {
    if (!location || location.trim().length < 2) return null;
    const normalized = location.trim();

    for (const entry of TIMEZONE_MAP) {
        if (entry.patterns.test(normalized)) {
            return entry.offsetHours;
        }
    }

    return null;
}

/**
 * Calcola il delay in secondi per schedulare un invito nelle ore lavorative del lead.
 *
 * Logica:
 *   1. Inferisce il fuso orario del lead dalla location
 *   2. Calcola che ora è adesso nel fuso del lead
 *   3. Se è nelle ore lavorative (9-17) → delay 0 (invia subito)
 *   4. Se è fuori orario → delay fino alle 9:00+jitter del lead
 *
 * @returns delay in secondi, 0 se già in orario o location sconosciuta
 */
export function computeTimezoneDelaySec(location: string | null | undefined): number {
    const offset = inferTimezoneOffset(location);
    if (offset === null) return 0;

    const now = new Date();
    const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
    const leadLocalHour = (((utcHour + offset) % 24) + 24) % 24;

    const workStart = 9;
    const workEnd = 17;

    if (leadLocalHour >= workStart && leadLocalHour < workEnd) {
        return 0;
    }

    // Calcola ore fino alle 9:00 nel fuso del lead
    let hoursUntilWorkStart: number;
    if (leadLocalHour < workStart) {
        hoursUntilWorkStart = workStart - leadLocalHour;
    } else {
        hoursUntilWorkStart = 24 - leadLocalHour + workStart;
    }

    // Jitter ±30 minuti per non inviare tutti alle 9:00:00 esatte
    const jitterMinutes = Math.floor(Math.random() * 60) - 30;
    const totalSeconds = Math.max(0, Math.floor((hoursUntilWorkStart * 60 + jitterMinutes) * 60));

    return totalSeconds;
}
