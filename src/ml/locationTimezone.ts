/**
 * ml/locationTimezone.ts
 * Mapping location del lead → timezone IANA → delay per inviare durante le ore lavorative del lead.
 * Usa lookup fuzzy sulla stringa location (es. "Milan, Italy" → Europe/Rome).
 *
 * Perché IANA e non un offset fisso: l'offset di una zona cambia con l'ora legale. Una tabella di
 * offset costanti sbaglia di un'ora per metà anno su Europa, UK e Nord America — e sbaglia per TUTTI
 * i lead di quelle zone nello stesso verso, cioè sposta l'intera popolazione di invii fuori dalla
 * finestra plausibile. `Intl.DateTimeFormat` con timeZone IANA risolve l'offset alla data richiesta,
 * quindi il DST è gestito dal database tz del runtime e non da una costante che invecchia.
 */

// ─── Mapping city/country/region → timezone IANA ────────────────────────────
// L'ordine conta: vince il primo pattern che matcha, quindi le zone più specifiche stanno prima
// di quelle che le conterrebbero (es. Phoenix prima del resto del Mountain Time).

const TIMEZONE_MAP: ReadonlyArray<{ patterns: RegExp; timeZone: string }> = [
    // Nord America
    {
        patterns:
            /\b(new york|boston|miami|washington|philadelphia|atlanta|charlotte|orlando|tampa|detroit|pittsburgh|cleveland|cincinnati|nashville|est\b)\b/i,
        timeZone: 'America/New_York',
    },
    {
        patterns:
            /\b(chicago|houston|dallas|austin|san antonio|minneapolis|milwaukee|st\.? louis|kansas city|memphis|new orleans|cst\b)\b/i,
        timeZone: 'America/Chicago',
    },
    // Phoenix NON osserva l'ora legale, il resto del Mountain Time sì: separati, prima il caso
    // specifico. Con l'offset fisso erano indistinguibili e in estate uno dei due era sbagliato.
    { patterns: /\b(phoenix|tucson|arizona)\b/i, timeZone: 'America/Phoenix' },
    { patterns: /\b(denver|salt lake|albuquerque|el paso|mst\b)\b/i, timeZone: 'America/Denver' },
    {
        patterns:
            /\b(los angeles|san francisco|seattle|portland|san diego|san bernardino|las vegas|sacramento|riverside|fresno|pst\b)\b/i,
        timeZone: 'America/Los_Angeles',
    },
    { patterns: /\b(anchorage|alaska)\b/i, timeZone: 'America/Anchorage' },
    { patterns: /\b(honolulu|hawaii)\b/i, timeZone: 'Pacific/Honolulu' },
    { patterns: /\b(toronto|montreal|ottawa|quebec)\b/i, timeZone: 'America/Toronto' },
    // Vancouver è Pacific, Calgary/Edmonton sono Mountain: un'ora di differenza fra loro, che la
    // vecchia riga unica (-7 per tutte) sbagliava su Vancouver tutto l'anno.
    { patterns: /\b(vancouver)\b/i, timeZone: 'America/Vancouver' },
    { patterns: /\b(calgary|edmonton)\b/i, timeZone: 'America/Edmonton' },
    { patterns: /\b(mexico city|guadalajara|monterrey|m[eé]xico)\b/i, timeZone: 'America/Mexico_City' },
    { patterns: /\b(são paulo|sao paulo|rio de janeiro|brasilia|brasil|brazil)\b/i, timeZone: 'America/Sao_Paulo' },
    { patterns: /\b(buenos aires|argentina)\b/i, timeZone: 'America/Argentina/Buenos_Aires' },
    { patterns: /\b(santiago|chile)\b/i, timeZone: 'America/Santiago' },
    { patterns: /\b(bogot[aá]|colombia)\b/i, timeZone: 'America/Bogota' },
    { patterns: /\b(lima|per[uú])\b/i, timeZone: 'America/Lima' },

    // Europa Occidentale (CET/CEST)
    {
        patterns:
            /\b(milano|milan|rome|roma|naples|napoli|turin|torino|florence|firenze|bologna|genova|palermo|catania|bari|padova|brescia|verona|italia|italy)\b/i,
        timeZone: 'Europe/Rome',
    },
    {
        patterns: /\b(paris|lyon|marseille|toulouse|nice|nantes|bordeaux|lille|strasbourg|france|francia)\b/i,
        timeZone: 'Europe/Paris',
    },
    {
        patterns:
            /\b(berlin|munich|m[uü]nchen|hamburg|frankfurt|cologne|k[oö]ln|düsseldorf|stuttgart|dortmund|essen|germany|deutschland|germania)\b/i,
        timeZone: 'Europe/Berlin',
    },
    { patterns: /\b(madrid|barcelona|valencia|sevilla|bilbao|malaga|spain|españa|spagna)\b/i, timeZone: 'Europe/Madrid' },
    {
        patterns: /\b(amsterdam|rotterdam|den haag|utrecht|netherlands|nederland|olanda|paesi bassi)\b/i,
        timeZone: 'Europe/Amsterdam',
    },
    { patterns: /\b(brussels|bruxelles|antwerp|belgium|belgio|belgique)\b/i, timeZone: 'Europe/Brussels' },
    { patterns: /\b(vienna|wien|austria|graz|linz)\b/i, timeZone: 'Europe/Vienna' },
    {
        patterns: /\b(zurich|z[uü]rich|geneva|gen[eè]ve|bern|basel|switzerland|svizzera|schweiz)\b/i,
        timeZone: 'Europe/Zurich',
    },
    { patterns: /\b(lisbon|lisboa|porto|portugal)\b/i, timeZone: 'Europe/Lisbon' },

    // Europa Orientale e Centrale
    { patterns: /\b(athens|atene|greece|grecia)\b/i, timeZone: 'Europe/Athens' },
    { patterns: /\b(helsinki|finland|finlandia)\b/i, timeZone: 'Europe/Helsinki' },
    { patterns: /\b(bucharest|romania)\b/i, timeZone: 'Europe/Bucharest' },
    { patterns: /\b(warsaw|varsavia|krakow|cracovia|poland|polonia)\b/i, timeZone: 'Europe/Warsaw' },
    { patterns: /\b(prague|praga|czech|repubblica ceca)\b/i, timeZone: 'Europe/Prague' },
    // Aggiunta col fix dei confini di parola: prima NON esisteva, e «Kyiv, Ukraine» finiva su
    // Europe/London perche' `uk` matchava dentro «Ukraine». Tolta la collisione restava senza casa.
    { patterns: /\b(kyiv|kiev|ukraine|ucraina|lviv|odesa|odessa)\b/i, timeZone: 'Europe/Kyiv' },

    // UK + Irlanda
    {
        patterns:
            /\b(london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|uk|united kingdom|england|scotland|wales)\b/i,
        timeZone: 'Europe/London',
    },
    { patterns: /\b(dublin|cork|ireland|irlanda)\b/i, timeZone: 'Europe/Dublin' },

    // Medio Oriente
    { patterns: /\b(dubai|abu dhabi|uae|emirati|emirates)\b/i, timeZone: 'Asia/Dubai' },
    { patterns: /\b(riyadh|jeddah|saudi|arabia saudita)\b/i, timeZone: 'Asia/Riyadh' },
    // Israele ha un'ora legale con date proprie, diverse da quelle europee.
    { patterns: /\b(tel aviv|jerusalem|israel|israele)\b/i, timeZone: 'Asia/Jerusalem' },
    { patterns: /\b(istanbul|ankara|turkey|turchia|t[uü]rkiye)\b/i, timeZone: 'Europe/Istanbul' },

    // Asia
    { patterns: /\b(mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|pune|kolkata|india)\b/i, timeZone: 'Asia/Kolkata' },
    { patterns: /\b(singapore|singapo)\b/i, timeZone: 'Asia/Singapore' },
    { patterns: /\b(hong kong)\b/i, timeZone: 'Asia/Hong_Kong' },
    { patterns: /\b(tokyo|osaka|japan|giappone)\b/i, timeZone: 'Asia/Tokyo' },
    { patterns: /\b(seoul|south korea|corea)\b/i, timeZone: 'Asia/Seoul' },
    { patterns: /\b(beijing|shanghai|shenzhen|guangzhou|china|cina)\b/i, timeZone: 'Asia/Shanghai' },
    { patterns: /\b(bangkok|thailand|tailandia)\b/i, timeZone: 'Asia/Bangkok' },
    { patterns: /\b(jakarta|indonesia)\b/i, timeZone: 'Asia/Jakarta' },

    // Oceania — quattro zone diverse che la vecchia riga unica schiacciava tutte su +10:
    // Perth ne dista 2 ore, Adelaide 30 minuti, e solo Sydney/Melbourne osservano l'ora legale.
    { patterns: /\b(perth)\b/i, timeZone: 'Australia/Perth' },
    { patterns: /\b(brisbane)\b/i, timeZone: 'Australia/Brisbane' },
    { patterns: /\b(adelaide)\b/i, timeZone: 'Australia/Adelaide' },
    { patterns: /\b(sydney|melbourne|canberra|australia)\b/i, timeZone: 'Australia/Sydney' },
    { patterns: /\b(auckland|wellington|new zealand|nuova zelanda)\b/i, timeZone: 'Pacific/Auckland' },

    // Africa
    { patterns: /\b(cairo|egypt|egitto)\b/i, timeZone: 'Africa/Cairo' },
    { patterns: /\b(johannesburg|cape town|south africa|sudafrica)\b/i, timeZone: 'Africa/Johannesburg' },
    { patterns: /\b(lagos|nigeria)\b/i, timeZone: 'Africa/Lagos' },
    { patterns: /\b(nairobi|kenya)\b/i, timeZone: 'Africa/Nairobi' },
];

/**
 * Risolve la timezone IANA dalla location del lead.
 * @returns identificatore IANA (es. 'Europe/Rome') o null se non riconosciuto
 */
export function inferTimeZone(location: string | null | undefined): string | null {
    if (!location || location.trim().length < 2) return null;
    const normalized = location.trim();

    for (const entry of TIMEZONE_MAP) {
        if (entry.patterns.test(normalized)) {
            return entry.timeZone;
        }
    }

    return null;
}

/**
 * Offset UTC in ore di una timezone IANA a un istante dato (ora legale inclusa).
 *
 * Metodo: si formatta lo stesso istante nella zona richiesta, si ricostruisce quella lettura come
 * se fosse UTC e si misura di quanto si discosta dall'istante reale. È la via senza dipendenze
 * esterne; `hourCycle: 'h23'` evita che la mezzanotte venga resa come "24".
 *
 * @returns offset in ore (può essere frazionario: +5.5 India, +9.5 Adelaide), o null se la zona
 *          non è risolvibile dal runtime — il chiamante degrada al comportamento neutro.
 */
function getUtcOffsetHours(timeZone: string, at: Date): number | null {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(at);

        const field = (type: Intl.DateTimeFormatPartTypes): number => {
            const value = parts.find((part) => part.type === type)?.value;
            const parsed = value === undefined ? Number.NaN : Number(value);
            return parsed;
        };

        const asUtc = Date.UTC(
            field('year'),
            field('month') - 1,
            field('day'),
            field('hour'),
            field('minute'),
            field('second'),
        );
        if (!Number.isFinite(asUtc)) return null;

        // Il secondo è già allineato fra le due letture: si arrotonda al minuto per togliere il
        // residuo dei millisecondi, che formatToParts non riporta.
        return Math.round((asUtc - at.getTime()) / 60000) / 60;
    } catch {
        // Zona non riconosciuta dal database tz del runtime: nessun offset, non un offset sbagliato.
        return null;
    }
}

/**
 * Inferisce l'offset UTC (ore) dalla location del lead, alla data indicata.
 *
 * A differenza della versione precedente il valore NON è costante nell'anno: per Milano vale +1 in
 * inverno e +2 in ora legale. Firma invariata per i chiamanti esistenti.
 *
 * @returns offset in ore (es. -4 per New York in estate, +2 per Roma in estate) o null se la
 *          location non è riconosciuta
 */
export function inferTimezoneOffset(location: string | null | undefined, at: Date = new Date()): number | null {
    const timeZone = inferTimeZone(location);
    if (timeZone === null) return null;
    return getUtcOffsetHours(timeZone, at);
}

/**
 * Calcola il delay in secondi per schedulare un invito nelle ore lavorative del lead.
 *
 * Logica:
 *   1. Inferisce il fuso orario del lead dalla location
 *   2. Calcola che ora è adesso nel fuso del lead (ora legale inclusa)
 *   3. Se è nelle ore lavorative (9-17) → delay 0 (invia subito)
 *   4. Se è fuori orario → delay fino alle 9:00+jitter del lead
 *
 * @returns delay in secondi, 0 se già in orario o location sconosciuta
 */
export function computeTimezoneDelaySec(location: string | null | undefined): number {
    const now = new Date();
    const offset = inferTimezoneOffset(location, now);
    if (offset === null) return 0;

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
