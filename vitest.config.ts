import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Evita il bootstrap su "localhost" quando il resolver locale della macchina è rotto.
    server: {
        host: '127.0.0.1',
    },
    test: {
        globals: false,
        environment: 'node',
        include: ['src/tests/**/*.vitest.ts'],
        exclude: [],
        testTimeout: 30_000,
        // Stesso budget dei test, e non per simmetria estetica: i `beforeAll` di `e2e-api` e
        // `e2e-dashboard` importano `api/server`, cioe' fanno il bootstrap dell'intera app Express.
        // Con la suite completa in parallelo quel bootstrap supera il default di 10s e i due file
        // falliscono con "Hook timed out" — riproducibile, e in isolamento gli stessi file passano
        // in 3,7s. Il tempo lo consuma il caricamento dei moduli sotto carico, non un hang: un
        // budget da hook unitario applicato a un hook che avvia un server era la misura sbagliata.
        hookTimeout: 30_000,
        // I test lavorano su una COPIA del database, mai su quello di produzione:
        // globalSetup la crea una volta sola, setupFiles la espone a ogni worker
        // tramite DB_PATH (le due fasi girano in processi diversi e non possono
        // scambiarsi valori: il percorso è calcolato da entrambe).
        globalSetup: ['src/tests/setup/globalSetup.ts'],
        setupFiles: ['src/tests/setup/vitestSetup.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/tests/**',
                'src/frontend/**',
                'src/scripts/**',
                'src/cli/**',
                'src/types/**',
            ],
            reporter: ['text', 'text-summary', 'lcov'],
            reportsDirectory: './coverage',
        },
    },
});
