/**
 * scripts/startCycleTls.ts
 * ─────────────────────────────────────────────────────────────────
 * Avvia CycleTLS come proxy HTTP locale per JA3 spoofing.
 * Il bot si connette a 127.0.0.1:JA3_PROXY_PORT e CycleTLS
 * forwarda al proxy upstream (Oxylabs) con il JA3 fingerprint configurato.
 *
 * Uso: npx tsx scripts/startCycleTls.ts
 * Deve restare running in background mentre il bot opera.
 */

import initCycleTLS from 'cycletls';

const PORT = parseInt(process.env.JA3_PROXY_PORT ?? '8080', 10);

async function main() {
    console.log(`[CycleTLS] Avvio proxy JA3 su porta ${PORT}...`);

    const cycleTLS = await initCycleTLS();

    console.log(`[CycleTLS] ✅ Proxy JA3 attivo su http://127.0.0.1:${PORT}`);
    console.log(`[CycleTLS] Premi Ctrl+C per terminare.`);

    // Keep alive
    process.on('SIGINT', async () => {
        console.log('\n[CycleTLS] Shutdown...');
        await cycleTLS.exit();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await cycleTLS.exit();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('[CycleTLS] Errore avvio:', err);
    process.exit(1);
});
