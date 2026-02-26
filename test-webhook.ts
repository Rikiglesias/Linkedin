import { createServer } from 'http';
import { runWebhookSyncOnce } from './src/sync/webhookSyncWorker';
import { pushOutboxEvent } from './src/core/repositories';
import { config } from './src/config';

async function runTest() {
    console.log('Avvio Webhook Receiver Mock su porta 9999...');

    let receivedPayload = false;
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            console.log(`[RCVD] POST ${req.url}`);
            console.log(`[HEADERS] signature:`, req.headers['x-signature-sha256']);
            console.log(`[BODY]`, body);
            receivedPayload = true;
            res.writeHead(200);
            res.end('OK');
        });
    });

    server.listen(9999, async () => {
        try {
            // Setup puntuale `.env` override a runtime
            config.webhookSyncEnabled = true;
            config.webhookSyncUrl = 'http://127.0.0.1:9999/webhook';
            config.webhookSyncSecret = 'test-secret';
            config.eventSyncSink = 'WEBHOOK';

            console.log('Inietto finto evento LEAD_ACCEPTED in outbox_events...');
            const idemp = `test-idemp-${Date.now()}`;
            await pushOutboxEvent('LEAD_ACCEPTED', { profileUrl: 'https://linkedin.com/in/test' }, idemp);

            console.log('Invoco execution sync cycle...');
            await runWebhookSyncOnce();

            if (receivedPayload) {
                console.log('✅ TEST WEBHOOK SUPERATO: Il worker ha letto SQLite e contattato il receiver.');
            } else {
                console.error('❌ TEST WEBHOOK FALLITO: Nessun payload ricevuto.');
                process.exitCode = 1;
            }

            // Allow time for node to flush stdout
            setTimeout(() => {
                server.close();
            }, 500);
        } catch (e) {
            console.error('Errore durante Test:', e);
            process.exitCode = 1;
            server.close();
        }
    });
}

runTest();
