const QWERTY_ADJACENT: Record<string, string[]> = {
    q: ['w', 'a', 's'],
    w: ['q', 'e', 'a', 's', 'd'],
    e: ['w', 'r', 's', 'd', 'f'],
    r: ['e', 't', 'd', 'f', 'g'],
    t: ['r', 'y', 'f', 'g', 'h'],
    y: ['t', 'u', 'g', 'h', 'j'],
    u: ['y', 'i', 'h', 'j', 'k'],
    i: ['u', 'o', 'j', 'k', 'l'],
    o: ['i', 'p', 'k', 'l'],
    p: ['o', 'l'],
    a: ['q', 'w', 's', 'z', 'x'],
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
};

export function determineNextKeystroke(char: string, baseTypoProb: number = 0.03): { char: string; isTypo: boolean } {
    if (Math.random() < baseTypoProb) {
        const lowerChar = char.toLowerCase();
        const neighbors = QWERTY_ADJACENT[lowerChar];
        if (neighbors && neighbors.length > 0) {
            const typo = neighbors[Math.floor(Math.random() * neighbors.length)];
            const chosenChar = typo ?? lowerChar;
            return { char: char === lowerChar ? chosenChar : chosenChar.toUpperCase(), isTypo: true };
        }
    }
    return { char, isTypo: false };
}
