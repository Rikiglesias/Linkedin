/**
 * doctorCommand.ts — `doctor [--no-browser]`
 *
 * Diagnostica completa (DB, sessione, proxy, compliance, selettori) stampata come JSON puro su stdout.
 * `--no-browser` (C15) salta il check di login via browser: `runDoctor({ skipBrowserSessionCheck: true })`, lo
 * stesso ramo che il loop gate usa a ogni ciclo (`loopCommand.ts`). Serve alle sonde e agli script che vogliono
 * lo stato del bot SENZA aprire una sessione su LinkedIn solo per verificare il login. Senza flag il check resta
 * completo, come prima.
 *
 * Lo stdout è SOLO il JSON del report: chi lo consuma da script (`node dist/index.js doctor --no-browser > out.json`)
 * deve poterlo parsare senza filtrare log. I messaggi diagnostici vanno su stderr.
 */
import { runDoctor } from '../../core/doctor';
import { hasOption } from '../cliParser';
import { writeJsonResult } from '../jsonStdout';

export const DOCTOR_USAGE = 'doctor [--no-browser]';
export const DOCTOR_NO_BROWSER_FLAG = '--no-browser';

export async function runDoctorCommand(args: string[]): Promise<void> {
    const skipBrowserSessionCheck = hasOption(args, DOCTOR_NO_BROWSER_FLAG);
    const report = await runDoctor({ skipBrowserSessionCheck });
    // Il vero stdout: la guardia installata in `index.ts` ha già deviato su stderr il rumore di bootstrap.
    writeJsonResult(report);
}
