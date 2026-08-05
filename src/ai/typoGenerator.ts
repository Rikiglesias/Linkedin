const QWERTY_ADJACENT: Record<string, string[]> = {
    q: ['w', 'a', 's'],
    w: ['q', 'e', 'a', 's', 'd'],
    e: ['w', 'r', 's', 'd', 'f', 'è', 'é'],
    r: ['e', 't', 'd', 'f', 'g'],
    t: ['r', 'y', 'f', 'g', 'h'],
    y: ['t', 'u', 'g', 'h', 'j'],
    u: ['y', 'i', 'h', 'j', 'k', 'ù'],
    i: ['u', 'o', 'j', 'k', 'l', 'ì'],
    o: ['i', 'p', 'k', 'l', 'ò'],
    p: ['o', 'l'],
    a: ['q', 'w', 's', 'z', 'x', 'à'],
    s: ['a', 'd', 'w', 'e', 'z', 'x', 'c'],
    d: ['s', 'f', 'e', 'r', 'x', 'c', 'v'],
    f: ['d', 'g', 'r', 't', 'c', 'v', 'b'],
    g: ['f', 'h', 't', 'y', 'v', 'b', 'n'],
    h: ['g', 'j', 'y', 'u', 'b', 'n', 'm'],
    j: ['h', 'k', 'u', 'i', 'n', 'm'],
    k: ['j', 'l', 'i', 'o', 'm'],
    l: ['k', 'o', 'p'],
    z: ['a', 's', 'x'],
    x: ['z', 's', 'd', 'c'],
    c: ['x', 'd', 'f', 'v'],
    v: ['c', 'f', 'g', 'b'],
    b: ['v', 'g', 'h', 'n'],
    n: ['b', 'h', 'j', 'm'],
    m: ['n', 'j', 'k'],
    // Italian accented characters (IT QWERTY layout)
    à: ['a', 'l', 'ò'],
    è: ['e', 'p', '+'],
    é: ['e', 'è'],
    ì: ['i', '='],
    ò: ['o', 'à', 'l'],
    ù: ['u', '['],
};

type TypoKind = 'adjacent' | 'double' | 'missing' | 'transposition';

// ─── Session Typo Rate ──────────────────────────────────────────────────────

/** Cached session typo rate — computed once per process */
let _sessionTypoRate: number | null = null;

/**
 * Computes a session-aware typo rate (0.015–0.07) to avoid a fixed fingerprint.
 *
 * Factors:
 *   - Account seed: deterministic per-account baseline from ACCOUNT_ID env
 *   - Time of day: more typos early morning (< 8) and late evening (> 21)
 *   - Session fatigue: increases slowly during the process uptime
 *
 * The rate is computed once per session and cached.
 */
/**
 * Seme deterministico per-account, normalizzato in [0,1). FNV-1a su `ACCOUNT_ID` (o
 * `LINKEDIN_ACCOUNT`).
 *
 * ESTRATTA da `computeSessionTypoRate`, non riscritta: serve anche al dwell dei tasti
 * (`humanKeystrokeDwellMs`), che era hard-coded uguale su ogni account mentre questo vicino era gia'
 * seedato **proprio per non fare fingerprint** — due parametri della stessa persona simulata devono
 * derivare dallo STESSO seme, altrimenti si contraddicono. Un secondo hash con un'altra formula
 * sarebbe una seconda identita' per lo stesso account.
 *
 * Account non configurato ⇒ stringa vuota ⇒ seme costante: e' voluto (deterministico per ambiente),
 * la varianza vera la porta la distribuzione, non il seme.
 */
/**
 * Account della sessione browser in corso. Impostato da `launchBrowser`, che e' l'unico punto in cui
 * l'identita' reale e' nota.
 *
 * 🔴 Perche' non basta l'env: `ACCOUNT_ID`/`LINKEDIN_ACCOUNT` non sono valorizzati **da nessuna
 * parte** in questo progetto (nessun `.env.example`, nessun compose, nessuna config: l'unico
 * riferimento era la riga che li legge). Il seme sarebbe quindi caduto sempre sulla stringa vuota =
 * costante, e il dwell sarebbe rimasto **identico su tutti gli account** — cioe' F-6ce4907b chiuso
 * sulla carta e aperto nella realta'. L'`accountId` vero esiste gia' e `launcher.ts:297-301` lo usa
 * per seedare il FINGERPRINT: il dwell deve derivare dallo STESSO, altrimenti la stessa persona
 * simulata avrebbe due identita' diverse su due assi (zero-O).
 */
let _accountCorrente: string | null = null;

/** Chiamata da `launchBrowser` all'avvio della sessione, con l'account realmente in uso. */
export function impostaSemeAccount(accountId: string): void {
    _accountCorrente = accountId;
}

export function semeAccount01(): number {
    const accountId = _accountCorrente || process.env.ACCOUNT_ID || process.env.LINKEDIN_ACCOUNT || '';
    let seedHash = 2166136261;
    for (let i = 0; i < accountId.length; i++) {
        seedHash ^= accountId.charCodeAt(i);
        seedHash = Math.imul(seedHash, 16777619);
    }
    return ((seedHash >>> 0) % 10000) / 10000;
}

export function computeSessionTypoRate(): number {
    if (_sessionTypoRate !== null) return _sessionTypoRate;

    const BASE_MIN = 0.015;
    const BASE_MAX = 0.07;

    // 1. Account seed: deterministic baseline from ACCOUNT_ID (or fallback random)
    const accountSeed = semeAccount01();
    // Account baseline: 0.02–0.05 range
    const accountBaseline = 0.02 + accountSeed * 0.03;

    // 2. Time-of-day factor: more typos early morning and late evening
    const hour = new Date().getHours();
    let todFactor = 0;
    if (hour < 8)
        todFactor = 0.008 + (8 - hour) * 0.002; // 6am = +0.012
    else if (hour > 21)
        todFactor = 0.005 + (hour - 21) * 0.003; // 11pm = +0.011
    else if (hour >= 12 && hour <= 14) todFactor = 0.003; // post-lunch dip

    // 3. Session fatigue: +0.5% every 30min of uptime (max +2%)
    const uptimeMinutes = process.uptime() / 60;
    const fatigueFactor = Math.min(0.02, (uptimeMinutes / 30) * 0.005);

    // Combine and clamp
    const rate = accountBaseline + todFactor + fatigueFactor;
    _sessionTypoRate = Math.max(BASE_MIN, Math.min(BASE_MAX, rate));
    return _sessionTypoRate;
}

/** Reset the cached rate (useful for testing or long-running sessions) */
export function resetSessionTypoRate(): void {
    _sessionTypoRate = null;
}

// ─── Typing Flow State (6.3) ────────────────────────────────────────────────

// Parole comuni — digitate in "flow state" (più veloci)
const COMMON_WORDS = new Set([
    'the',
    'and',
    'for',
    'that',
    'with',
    'this',
    'from',
    'your',
    'have',
    'been',
    'will',
    'are',
    'was',
    'not',
    'but',
    'all',
    'can',
    'had',
    'her',
    'one',
    'our',
    'out',
    'you',
    'day',
    'get',
    'has',
    'him',
    'his',
    'how',
    'its',
    'may',
    'new',
    'now',
    'old',
    'see',
    'way',
    'who',
    'did',
    'let',
    'say',
    // Italian common words
    'che',
    'per',
    'con',
    'una',
    'sono',
    'del',
    'non',
    'come',
    'alla',
    'anche',
    'più',
    'nel',
    'hai',
    'era',
    'dal',
    'suo',
    'molto',
    'dopo',
    'dove',
    'solo',
    // Business common words
    'team',
    'work',
    'would',
    'like',
    'about',
    'great',
    'time',
    'look',
    'help',
    'know',
    'just',
    'make',
    'think',
    'good',
    'need',
    'well',
    'back',
    'want',
]);

/**
 * Calcola il moltiplicatore di velocità per una parola in base alla sua frequenza.
 * Parole comuni → 0.7x (più veloci, flow state)
 * Parole normali → 1.0x
 * Parole rare/lunghe → 1.4x (più lente, pensiero)
 */
export function getWordFlowMultiplier(word: string): number {
    const lower = word.toLowerCase().trim();
    if (!lower || lower.length <= 1) return 1.0;
    if (COMMON_WORDS.has(lower)) return 0.7;
    if (lower.length > 10) return 1.4; // Parole lunghe = rare
    if (/[0-9@#$%]/.test(lower)) return 1.3; // Numeri/simboli = pensiero
    return 1.0;
}

// ─── Core ───────────────────────────────────────────────────────────────────

export function determineNextKeystroke(char: string, baseTypoProb: number = 0.03): { char: string; isTypo: boolean } {
    if (Math.random() < baseTypoProb) {
        const lowerChar = char.toLowerCase();

        // Choose typo type with realistic distribution
        const roll = Math.random();
        let typoKind: TypoKind;
        if (roll < 0.5) typoKind = 'adjacent';
        else if (roll < 0.7) typoKind = 'double';
        else if (roll < 0.85) typoKind = 'transposition';
        else typoKind = 'missing';

        if (typoKind === 'adjacent') {
            const neighbors = QWERTY_ADJACENT[lowerChar];
            if (neighbors && neighbors.length > 0) {
                const typo = neighbors[Math.floor(Math.random() * neighbors.length)];
                const chosenChar = typo ?? lowerChar;
                return { char: char === lowerChar ? chosenChar : chosenChar.toUpperCase(), isTypo: true };
            }
        } else if (typoKind === 'double') {
            // Double letter: "nn" instead of "n"
            return { char: char + char, isTypo: true };
        } else if (typoKind === 'missing') {
            // Missing letter: skip the character
            return { char: '', isTypo: true };
        }
        // 'transposition' is handled at a higher level (caller should swap with next char)
        // Fall through to no-typo for single-char context
    }
    return { char, isTypo: false };
}
