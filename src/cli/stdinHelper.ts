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
 * Chiede un valore numerico con default.
 */
export async function askNumber(prompt: string, defaultValue: number): Promise<number> {
    const raw = await readLineFromStdin(`${prompt} (default: ${defaultValue}): `);
    if (!raw) return defaultValue;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

/**
 * Chiede una scelta tra opzioni.
 */
export async function askChoice<T extends string>(prompt: string, choices: T[], defaultChoice: T): Promise<T> {
    const raw = await readLineFromStdin(`${prompt} [${choices.join('/')}] (default: ${defaultChoice}): `);
    if (!raw) return defaultChoice;
    const match = choices.find((c) => c.toLowerCase() === raw.toLowerCase());
    return match ?? defaultChoice;
}

/**
 * Rileva se lo stdin è un terminale interattivo.
 * Su Windows, `npm start` non passa stdin come TTY ma stdout sì —
 * usiamo stdout.isTTY come fallback per non saltare le domande interattive.
 */
export function isInteractiveTTY(): boolean {
    return process.stdin.isTTY === true || process.stdout.isTTY === true;
}
