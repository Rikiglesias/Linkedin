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
            process.stdin.removeListener('close', onClose);
            process.stdin.removeListener('error', onError);
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
        // Listener nominati: cleanup deve poterli rimuovere TUTTI (prima close/error once restavano
        // attaccati dopo una risoluzione via data -> accumulo cross-chiamata / MaxListeners warning).
        const onClose = () => {
            cleanup();
            resolve('');
        };
        const onError = () => {
            cleanup();
            resolve('');
        };
        process.stdin.on('data', onData);
        process.stdin.once('close', onClose);
        process.stdin.once('error', onError);
    });
}

/**
 * Logica pura: interpreta la risposta a una conferma Y/n rispettando il default.
 * Estratta da askConfirmation per essere testabile senza mockare stdin.
 * Empty (solo INVIO) -> defaultValue; 'y'/'yes'/'s'/'si' -> true; tutto il resto -> false.
 */
export function parseConfirmationAnswer(answer: string, defaultValue: boolean): boolean {
    const normalized = answer.trim().toLowerCase();
    if (normalized === '') return defaultValue;
    return normalized.startsWith('y') || normalized.startsWith('s');
}

/**
 * Chiede conferma Y/n.
 * `defaultValue` governa SOLO la pressione di INVIO a vuoto e DEVE riflettere il prompt:
 *   prompt "[Y/n]" -> defaultValue=true (default);  prompt "[y/N]" -> defaultValue=false.
 * In ambiente non-TTY (cron/automazione) stdin chiude vuoto -> ritorna defaultValue:
 * per i gate rischiosi ([y/N]) questo significa NON forzare l'azione (anti-ban / dati safe).
 */
export async function askConfirmation(
    prompt: string = 'Procedo? [Y/n] ',
    defaultValue: boolean = true,
): Promise<boolean> {
    const answer = await readLineFromStdin(prompt);
    return parseConfirmationAnswer(answer, defaultValue);
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
