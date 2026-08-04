/**
 * api/serverListenError.ts — cosa fare quando il server HTTP non riesce a mettersi in ascolto.
 *
 * Sta in un file suo, e non dentro `server.ts`, per una ragione pratica: importare `server.ts`
 * costruisce l'intera app Express (router, DB, config), quindi una verifica di questo pezzo
 * dovrebbe avviare mezzo programma. Qui invece si prova da sola.
 */

/**
 * Senza un handler sull'evento `error` del server, un EADDRINUSE è un evento non gestito: il
 * processo muore con lo stack trace, PM2 lo riavvia, la porta è ancora occupata, e si ricomincia.
 * È così che `logs/api-error.log` ha accumulato **3084** occorrenze dello stesso errore, senza che
 * da nessuna parte comparisse cosa fare per uscirne.
 *
 * `exit` è un parametro solo per poterlo osservare nei test: in esercizio è `process.exit`.
 */
export function handleServerListenError(
    error: NodeJS.ErrnoException,
    port: number,
    exit: (code: number) => never = process.exit,
): never {
    if (error.code !== 'EADDRINUSE') {
        // Causa non prevista: meglio morire rumorosamente che indovinare una diagnosi.
        throw error;
    }

    const comandoDiagnosi =
        process.platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -i :${port}`;

    console.error(
        [
            '',
            `❌ La dashboard non è partita: la porta ${port} è già occupata.`,
            "   PERCHÉ: un'altra istanza è già in ascolto — spesso un avvio precedente rimasto vivo,",
            '   oppure il container Docker che espone la stessa porta.',
            `   COSA FARE: trova chi la occupa con "${comandoDiagnosi}", chiudi quel processo`,
            "   (oppure avvia su un'altra porta) e riprova.",
            '',
        ].join('\n'),
    );

    return exit(1);
}
