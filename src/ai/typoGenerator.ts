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
    'à': ['a', 'l', 'ò'],
    'è': ['e', 'p', '+'],
    'é': ['e', 'è'],
    'ì': ['i', '='],
    'ò': ['o', 'à', 'l'],
    'ù': ['u', '['],
};

type TypoKind = 'adjacent' | 'double' | 'missing' | 'transposition';

export function determineNextKeystroke(char: string, baseTypoProb: number = 0.03): { char: string; isTypo: boolean } {
    if (Math.random() < baseTypoProb) {
        const lowerChar = char.toLowerCase();

        // Choose typo type with realistic distribution
        const roll = Math.random();
        let typoKind: TypoKind;
        if (roll < 0.50) typoKind = 'adjacent';
        else if (roll < 0.70) typoKind = 'double';
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
