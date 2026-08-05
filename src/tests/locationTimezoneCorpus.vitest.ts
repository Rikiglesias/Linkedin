import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inferTimeZone } from '../ml/locationTimezone';

/**
 * Corpus di localita' REALI per `inferTimeZone`, incluse le forme LOCALI (Milano, München, Genève,
 * Lisboa, Varsavia…) che e' come un lead scrive davvero la propria citta'.
 *
 * 🔴 Perche' esiste (F-a17c60be, 2026-08-05): i pattern erano `\b(...)` senza confine di parola in
 * CHIUSURA, quindi matchavano per PREFISSO. Collisioni misurate, non dedotte:
 *   - «Perugia, Italy»      -> America/Lima     (`per[uú]` dentro «PERUgia»)      ~7 h di errore
 *   - «Kyiv, Ukraine»       -> Europe/London    (`uk` dentro «UKraine»)            2 h
 *   - «San Bernardino, CA»  -> Europe/Zurich    (`bern` dentro «BERNardino»)      ~9 h
 *   - «Bucharest, Romania»  -> Europe/Rome      (`roma` dentro «ROMAnia»)           1 h
 * L'ultima NON era nella diagnosi: e' emersa misurando, non leggendo.
 *
 * ⚠️ E il fix ovvio era una TRAPPOLA, verificata prima di applicarlo: chiudere i gruppi con `\b`
 * risolve le collisioni ma fa perdere i match per prefisso LEGITTIMI — `milan\b` non matcha piu'
 * «Milano». Per questo la regola non e' «aggiungi `\b`» ma: aggiungi `\b` E aggiungi la forma
 * mancante all'elenco. Questo file e' la misura che tiene insieme le due meta': se qualcuno togliesse
 * un `\b` tornerebbero le collisioni, se togliesse una forma locale sparirebbe un match.
 *
 * Il timing conta davvero: questa mappa decide in che ORA del fuso del lead parte un invio. Un errore
 * di 7 ore sposta l'invio fuori dall'orario lavorativo, cioe' esattamente il segnale che il blocco
 * "invia quando il lead e' sveglio" esiste per evitare.
 */

/** location -> timezone IANA attesa. */
const CORPUS: ReadonlyArray<readonly [string, string]> = [
    // ── Le 4 collisioni misurate: questi casi erano SBAGLIATI prima del fix ──
    ['Kyiv, Ukraine', 'Europe/Kyiv'],
    ['Perugia, Italy', 'Europe/Rome'],
    ['San Bernardino, CA', 'America/Los_Angeles'],
    ['Bucharest, Romania', 'Europe/Bucharest'],

    // ── Forme locali: qui si romperebbe un `\b` aggiunto senza aggiungere la forma ──
    ['Milano', 'Europe/Rome'],
    ['Milano, Italia', 'Europe/Rome'],
    ['Torino, Italia', 'Europe/Rome'],
    ['Firenze', 'Europe/Rome'],
    ['Napoli', 'Europe/Rome'],
    ['Roma, Italia', 'Europe/Rome'],
    ['Bologna', 'Europe/Rome'],
    ['Genova', 'Europe/Rome'],
    ['Verona', 'Europe/Rome'],
    ['München, Deutschland', 'Europe/Berlin'],
    ['Köln', 'Europe/Berlin'],
    ['Hamburg', 'Europe/Berlin'],
    ['Berlin, Germany', 'Europe/Berlin'],
    ['Zürich, Schweiz', 'Europe/Zurich'],
    ['Genève', 'Europe/Zurich'],
    ['Bern', 'Europe/Zurich'],
    ['Lisboa, Portugal', 'Europe/Lisbon'],
    ['Bruxelles, Belgique', 'Europe/Brussels'],
    ['Wien, Austria', 'Europe/Vienna'],
    ['Varsavia, Polonia', 'Europe/Warsaw'],
    ['Praga', 'Europe/Prague'],
    ['Atene, Grecia', 'Europe/Athens'],
    ['Madrid, España', 'Europe/Madrid'],
    ['Amsterdam, Nederland', 'Europe/Amsterdam'],

    // ── Forme inglesi e resto del mondo: nessuna deve regredire ──
    ['Paris, France', 'Europe/Paris'],
    ['Lyon', 'Europe/Paris'],
    ['Barcelona', 'Europe/Madrid'],
    ['London, United Kingdom', 'Europe/London'],
    ['Manchester, UK', 'Europe/London'],
    ['Edinburgh, Scotland', 'Europe/London'],
    ['Dublin, Ireland', 'Europe/Dublin'],
    ['New York, NY', 'America/New_York'],
    ['San Francisco Bay Area', 'America/Los_Angeles'],
    ['Chicago, IL', 'America/Chicago'],
    ['Phoenix, AZ', 'America/Phoenix'],
    ['Denver, CO', 'America/Denver'],
    ['Toronto, ON', 'America/Toronto'],
    ['Vancouver, BC', 'America/Vancouver'],
    ['São Paulo, Brasil', 'America/Sao_Paulo'],
    ['Lima, Perú', 'America/Lima'],
    ['Bogotá, Colombia', 'America/Bogota'],
    ['Bengaluru, India', 'Asia/Kolkata'],
    ['Mumbai', 'Asia/Kolkata'],
    ['Singapore', 'Asia/Singapore'],
    ['Tokyo, Japan', 'Asia/Tokyo'],
    ['Shanghai, China', 'Asia/Shanghai'],
    ['Dubai, UAE', 'Asia/Dubai'],
    ['Tel Aviv, Israel', 'Asia/Jerusalem'],
    ['Sydney, Australia', 'Australia/Sydney'],
    ['Perth, WA', 'Australia/Perth'],
    ['Auckland, New Zealand', 'Pacific/Auckland'],
    ['Cairo, Egypt', 'Africa/Cairo'],
    ['Lagos, Nigeria', 'Africa/Lagos'],
];

describe('inferTimeZone — corpus di localita reali', () => {
    it.each(CORPUS)('"%s" risolve a %s', (location, atteso) => {
        expect(inferTimeZone(location)).toBe(atteso);
    });

    it('nessuna localita del corpus resta senza fuso', () => {
        const orfane = CORPUS.filter(([loc]) => inferTimeZone(loc) === null).map(([loc]) => loc);
        expect(orfane).toEqual([]);
    });
});

describe('confini di parola — la guardia strutturale', () => {
    it('OGNI pattern chiude il gruppo con \\b, non solo lo apre', () => {
        // Aprire con `\b(` e non chiudere e' esattamente il difetto: il match per prefisso.
        // Contare i due lati separatamente lo rende impossibile da reintrodurre in silenzio.
        const src = readFileSync(join(__dirname, '..', 'ml', 'locationTimezone.ts'), 'utf8');
        const patterns = [...src.matchAll(/patterns:\s*(\/(?:[^/\\]|\\.)+\/i)/g)].map((m) => m[1]);
        expect(patterns.length).toBeGreaterThanOrEqual(54);

        const senzaConfineFinale = patterns.filter((p) => !p.endsWith(')\\b/i'));
        expect(senzaConfineFinale).toEqual([]);
    });

    it('ROSSO DI CONTROLLO: togliendo il confine finale, 2 delle 4 collisioni tornano', () => {
        // Ricostruisce il comportamento VECCHIO togliendo il `\b` di chiusura e verifica che
        // producesse davvero gli esiti sbagliati misurati.
        // Sono DUE e non quattro, ed e' corretto che sia cosi': «Kyiv» e «San Bernardino» ora hanno
        // una voce dedicata che vincerebbe comunque, quindi per loro il `\b` non e' piu' l'unica
        // difesa. Per «Perugia» e «Bucharest» lo e': li' il difetto e' ancora osservabile, ed e'
        // quello che questo caso misura. Dire «4» sarebbe stato piu' bello e falso.
        const src = readFileSync(join(__dirname, '..', 'ml', 'locationTimezone.ts'), 'utf8');
        const voci = [...src.matchAll(/patterns:\s*(\/(?:[^/\\]|\\.)+\/i)\s*,\s*timeZone:\s*'([^']+)'/g)].map((m) => ({
            re: new RegExp(m[1].slice(1, -2).replace(/\)\\b$/, ')'), 'i'),
            tz: m[2],
        }));
        const comeUnaVolta = (s: string): string | null => voci.find((v) => v.re.test(s.toLowerCase()))?.tz ?? null;

        expect(comeUnaVolta('Perugia, Italy')).toBe('America/Lima');
        expect(comeUnaVolta('Kyiv, Ukraine')).toBe('Europe/Kyiv'); // ora c'e' la voce dedicata, prima cadeva su London
        expect(comeUnaVolta('San Bernardino, CA')).toBe('America/Los_Angeles'); // ora e' elencata, prima cadeva su Zurich
        expect(comeUnaVolta('Bucharest, Romania')).toBe('Europe/Rome');
    });
});
