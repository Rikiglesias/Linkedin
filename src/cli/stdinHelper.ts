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
        let buffer = '';
        const onData = (chunk: string) => {
            buffer += chunk;
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex !== -1) {
                process.stdin.removeListener('data', onData);
                resolve(buffer.slice(0, newlineIndex).replace(/\r/g, '').trim());
            }
        };
        process.stdin.on('data', onData);
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
 */
export function isInteractiveTTY(): boolean {
    return process.stdin.isTTY === true;
}
