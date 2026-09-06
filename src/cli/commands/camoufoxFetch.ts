/**
 * camoufoxFetch.ts — `camoufox-fetch [--check]` (C22 del contratto `bot-operativo`).
 *
 * `--check`: ispeziona la cache di Camoufox SENZA scaricare e stampa un JSON (stdout = solo JSON, guardia
 * `jsonStdout.ts`): exit 0 se binario e addon di default sono presenti e = `CAMOUFOX_BINARY_VERSION`
 * (`config/bot-settings.conf`), exit 1 con il comando che risolve altrimenti.
 * Senza flag: scarica il TAG ESATTO dichiarato (mai «latest») e ri-ispeziona; se è già tutto a posto non scarica
 * nulla (idempotente). È l'UNICO punto del bot che scarica Camoufox: il lancio si limita a rifiutare.
 */
import { config } from '../../config';
import { writeJsonResult } from '../jsonStdout';
import { inspectCamoufoxRuntime, installPinnedCamoufox } from '../../browser/camoufoxRuntime';

const FIX_FETCH = '.\\bot.ps1 camoufox-fetch';
const FIX_CONF = 'aggiungi CAMOUFOX_BINARY_VERSION=<versione collaudata> a config/bot-settings.conf';

export async function runCamoufoxFetchCommand(args: string[]): Promise<void> {
    const checkOnly = args.includes('--check');
    const pinned = config.camoufoxBinaryVersion;
    const before = inspectCamoufoxRuntime({ pinned });

    if (checkOnly || before.ok) {
        writeJsonResult({
            mode: checkOnly ? 'check' : 'fetch',
            downloaded: false,
            ...before,
            fix: before.ok ? null : pinned ? FIX_FETCH : FIX_CONF,
        });
        process.exitCode = before.ok ? 0 : 1;
        return;
    }

    if (!pinned) {
        writeJsonResult({ mode: 'fetch', downloaded: false, ...before, fix: FIX_CONF });
        process.exitCode = 1;
        return;
    }

    const after = await installPinnedCamoufox({ pinned });
    writeJsonResult({ mode: 'fetch', downloaded: true, ...after, fix: after.ok ? null : FIX_FETCH });
    process.exitCode = after.ok ? 0 : 1;
}
