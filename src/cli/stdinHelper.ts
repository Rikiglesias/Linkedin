/**
 * Attende che l'utente prema INVIO.
 */
export async function waitForEnter(): Promise<void> {
    await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', () => resolve());
    });
}

/**
 * Legge una riga di testo dallo stdin con prompt.
 */
export async function readLineFromStdin(prompt: string): Promise<string> {
    return new Promise<string>((resolve) => {
        process.stdout.write(prompt);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        let resolved = false;
        const cleanup = () => {
            if (resolved) return;
            resolved = true;
            process.stdin.removeListener('data', onData);
            process.stdin.pause();
        };
        let buffer = '';
        const onData = (chunk: string) => {
            buffer += chunk;
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex !== -1) {
                cleanup();
                resolve(buffer.slice(0, newlineIndex).replace(/\r/g, '').trim());
            }
        };
        process.stdin.on('data', onData);
        process.stdin.once('close', () => { cleanup(); resolve(''); });
        process.stdin.once('error', () => { cleanup(); resolve(''); });
    });
}

/**
 * Chiede conferma Y/n. Default: yes.
 */
export async function askConfirmation(prompt: string = 'Procedo? [Y/n] '): Promise<boolean> {
    const answer = await readLineFromStdin(prompt);
    return answer === '' || answer.toLowerCase().startsWith('y') || answer.toLowerCase().startsWith('s');
}

/**
 * Chiede un valore numerico con default. Valida l'input e ri-chiede se non è un numero.
 */
export async function askNumber(prompt: string, defaultValue?: number): Promise<number> {
    const defaultText = defaultValue !== undefined ? ` (default: ${defaultValue})` : '';
    while (true) {
        const raw = await readLineFromStdin(`${prompt}${defaultText}: `);
        if (!raw && defaultValue !== undefined) return defaultValue;
        if (!raw && defaultValue === undefined) {
            console.log('  [!] Inserisci un numero valido.');
            continue;
        }
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
        console.log('  [!] Errore: inserisci un numero valido (intero >= 0).');
    }
}

/**
 * Chiede una scelta tra opzioni con validazione hard.
 */
export async function askChoice<T extends string>(prompt: string, choices: T[], defaultChoice?: T): Promise<T> {
    const defaultText = defaultChoice !== undefined ? ` (default: ${defaultChoice})` : '';
    while (true) {
        const raw = await readLineFromStdin(`${prompt} [${choices.join('/')}]${defaultText}: `);
        if (!raw && defaultChoice !== undefined) return defaultChoice;
        if (!raw && defaultChoice === undefined) {
            console.log(`  [!] Scegli una delle opzioni: ${choices.join(', ')}`);
            continue;
        }
        const match = choices.find((c) => c.toLowerCase() === raw.toLowerCase());
        if (match) return match;
        console.log(`  [!] Errore: scelta non valida. Opzioni consentite: ${choices.join(', ')}`);
    }
}

/**
 * Rileva se lo stdin è un terminale interattivo.
 * Su Windows, `npm start` non passa stdin come TTY ma stdout sì —
 * usiamo stdout.isTTY come fallback per non saltare le domande interattive.
 */
export function isInteractiveTTY(): boolean {
    return process.stdin.isTTY === true || process.stdout.isTTY === true;
}
