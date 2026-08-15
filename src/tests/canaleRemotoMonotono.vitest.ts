import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../telemetry/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }));

// Sentinella di FORMA (non di nome): i moduli che eseguono comandi arrivati da FUORI il
// processo non devono poter chiamare un rilascio INCONDIZIONATO della pausa.
//
// Perché sulla forma e non sulla stringa: il call-site colpevole importava
// `clearAutomationPause as clearPauseState`, quindi cercare «clearAutomationPause» nel
// corpo del file non trovava niente e cercare «clearPauseState» si sarebbe fatto aggirare
// rinominando l'alias. Qui si guarda il SIMBOLO IMPORTATO (il nome prima di `as`), che è
// ciò che davvero lega il modulo alla capability.

const ROOT = join(__dirname, '..');

/** Simboli che spengono una protezione senza guardare da dove viene la richiesta. */
const RILASCI_INCONDIZIONATI = ['clearAutomationPause', 'resumeAutomation'];

/** Moduli che eseguono ordini provenienti da fuori il processo. */
const CANALI_REMOTI = [
    'cli/commands/loopCommand.ts', // comandi dalla tabella cloud `telegram_commands`
    'api/helpers/controlActions.ts', // route REST /controls/resume e /v1/automation/controls/resume
];

/** Estrae i simboli importati (nome canonico, prima di un eventuale `as`) da un sorgente. */
function simboliImportati(sorgente: string): string[] {
    const simboli: string[] = [];
    const importBlocks = sorgente.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gs);
    for (const block of importBlocks) {
        for (const voce of block[1].split(',')) {
            const nome = voce.trim().split(/\s+as\s+/)[0].trim();
            if (nome) simboli.push(nome);
        }
    }
    return simboli;
}

describe('il canale remoto è monotono-restrittivo', () => {
    for (const modulo of CANALI_REMOTI) {
        test(`${modulo} non importa un rilascio incondizionato della pausa`, () => {
            const sorgente = readFileSync(join(ROOT, modulo), 'utf8');
            const importati = simboliImportati(sorgente);

            const vietati = importati.filter((s) => RILASCI_INCONDIZIONATI.includes(s));

            expect(
                vietati,
                `${modulo} importa ${vietati.join(', ')}: da lì una richiesta remota può spegnere ` +
                    'una pausa aperta dall\'incident manager. Usare releaseAutomationPause({ channel }).',
            ).toEqual([]);
        });
    }

    test('il rilascio condizionato esiste ed è quello esportato dal repository', async () => {
        const sorgente = readFileSync(join(ROOT, 'core/repositories/system.ts'), 'utf8');
        expect(sorgente).toMatch(/export async function releaseAutomationPause/);
    });
});

describe('il rifiuto arriva a chi guarda la dashboard', () => {
    test('una ripresa rifiutata esce 409 col motivo, non 500 muto', async () => {
        const { handleApiError } = await import('../api/utils');
        const { ControlActionRejected } = await import('../api/helpers/controlErrors');

        let status = 0;
        let body: unknown = null;
        const res = {
            status(code: number) {
                status = code;
                return this;
            },
            json(payload: unknown) {
                body = payload;
                return this;
            },
        };

        handleApiError(
            res as never,
            new ControlActionRejected('SYSTEM_PAUSE', 'HTTP_429_RATE_LIMIT'),
            'api.controls.resume',
        );

        expect(status).toBe(409);
        const errore = (body as { error: { code: string; message: string; details: Record<string, unknown> } }).error;
        expect(errore.code).toBe('CONTROL_ACTION_REJECTED');
        expect(errore.message).toContain('HTTP_429_RATE_LIMIT');
        expect(errore.details.blockedBy).toBe('SYSTEM_PAUSE');
    });
});
