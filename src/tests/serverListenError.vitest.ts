import { describe, it, expect, vi, afterEach } from 'vitest';

import { handleServerListenError } from '../api/serverListenError';

/**
 * Il server non riusciva a mettersi in ascolto e moriva senza dire nulla di utile:
 * `logs/api-error.log` contiene 3084 occorrenze di EADDRINUSE, tutte stack trace.
 * Qui si verifica che una porta occupata produca un messaggio azionabile e un'uscita
 * pulita, e che un errore di altra natura NON venga mascherato da quel messaggio.
 */
function erroreDiRete(code: string): NodeJS.ErrnoException {
    const error = new Error(`listen ${code}`) as NodeJS.ErrnoException;
    error.code = code;
    return error;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('handleServerListenError', () => {
    it('porta occupata: esce con codice 1 e dice cosa fare, senza stack trace', () => {
        const righe: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
            righe.push(String(msg));
        });
        const exit = vi.fn(() => undefined as never);

        handleServerListenError(erroreDiRete('EADDRINUSE'), 3000, exit);

        expect(exit).toHaveBeenCalledWith(1);
        const messaggio = righe.join('\n');
        expect(messaggio).toContain('3000');
        // Deve contenere le tre cose che servono a chi legge: cosa, perché, cosa fare.
        expect(messaggio).toContain('PERCHÉ');
        expect(messaggio).toContain('COSA FARE');
        // ...e un comando davvero eseguibile sulla piattaforma corrente.
        expect(messaggio).toContain(process.platform === 'win32' ? 'netstat' : 'lsof');
    });

    it('errore di altra natura: rilancia invece di indovinare una diagnosi', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const exit = vi.fn(() => undefined as never);

        expect(() => handleServerListenError(erroreDiRete('EACCES'), 80, exit)).toThrowError(
            /EACCES/,
        );
        expect(exit).not.toHaveBeenCalled();
    });
});
