/**
 * jsonStdout.ts — guardia stdout per i comandi CLI che rispondono con un JSON (C15 del contratto `bot-operativo`).
 *
 * Problema: `node dist/index.js doctor --no-browser > out.json` non era parsabile. Prima che il comando parta, il
 * bootstrap scrive su stdout: dotenv stampa i suoi tip (`[dotenv@17] injecting env …`), `config/index.ts` logga
 * `[CONFIG] Profilo attivo`, il logger emette gli INFO con `console.log`. Il comando non può ripulire ciò che è già
 * uscito, quindi la guardia va installata in testa a `src/index.ts`, PRIMA di importare config/dotenv.
 *
 * Cosa fa, SOLO per i comandi elencati in `JSON_STDOUT_COMMANDS` (gli altri non cambiano di una virgola):
 *  - mette a tacere dotenv (`DOTENV_CONFIG_QUIET`, letta in `dotenv/lib/main.js:230`; un valore già impostato
 *    dall'utente vince);
 *  - devia su stderr tutto ciò che passa da `process.stdout.write`, `console.log` incluso (Node scrive con
 *    `stream.write(...)` risolto a ogni chiamata, quindi la sostituzione della proprietà basta);
 *  - tiene il vero stdout per il solo risultato, scritto con `writeJsonResult`.
 * `--help`/`-h` restano esclusi: l'help è testo per umani e va su stdout come per ogni altro comando.
 *
 * Nessuna dipendenza da config: questo modulo deve poter girare prima che dotenv venga caricato.
 */

/**
 * Comandi il cui stdout è per contratto SOLO un JSON (un consumatore da script lo parsa senza filtrare).
 * Ogni voce ha il suo print convertito a `writeJsonResult`: aggiungere qui un comando che stampa con `console.log`
 * lo manderebbe su stderr.
 */
const JSON_STDOUT_COMMANDS: ReadonlySet<string> = new Set([
    'doctor',
    'kpi',
    'sync-status',
    'config-validate',
    'incidents',
    'status',
    'diagnostics',
    'diag',
]);

let realStdoutWrite: typeof process.stdout.write | null = null;

export function isJsonStdoutCommand(command: string | undefined): boolean {
    return command !== undefined && JSON_STDOUT_COMMANDS.has(command);
}

/**
 * Installa la guardia se `argv[2]` è un comando JSON (e non è una richiesta di help). Idempotente.
 * @returns true se la guardia è attiva per questo processo.
 */
export function installJsonStdoutGuard(argv: readonly string[] = process.argv): boolean {
    if (!isJsonStdoutCommand(argv[2])) return false;
    if (argv.slice(3).some((arg) => arg === '--help' || arg === '-h')) return false;
    if (realStdoutWrite) return true;

    process.env.DOTENV_CONFIG_QUIET ??= 'true';
    realStdoutWrite = process.stdout.write.bind(process.stdout);
    const divert = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
        (process.stderr.write as unknown as (...args: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;
    process.stdout.write = divert;
    return true;
}

/** Scrive il risultato JSON sul VERO stdout (quello salvato dalla guardia, o quello corrente se non installata). */
export function writeJsonResult(value: unknown): void {
    const line = `${JSON.stringify(value, null, 2)}\n`;
    if (realStdoutWrite) {
        realStdoutWrite(line);
        return;
    }
    process.stdout.write(line);
}

/** Solo per i test: ripristina `process.stdout.write` e dimentica lo stato della guardia. */
export function resetJsonStdoutGuardForTests(): void {
    if (!realStdoutWrite) return;
    process.stdout.write = realStdoutWrite;
    realStdoutWrite = null;
}
