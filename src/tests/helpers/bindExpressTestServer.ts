import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';

export async function bindExpressTestServer(app: Express): Promise<Server> {
    const server = createServer(app);

    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            server.off('error', onError);
            server.off('listening', onListening);
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const onListening = () => {
            cleanup();
            resolve();
        };

        server.on('error', onError);
        server.on('listening', onListening);
        server.listen(0, '127.0.0.1');
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        await closeExpressTestServer(server);
        throw new Error('bindExpressTestServer(): address non disponibile.');
    }

    const info = address as AddressInfo;
    if (info.address !== '127.0.0.1') {
        await closeExpressTestServer(server);
        throw new Error(`bindExpressTestServer(): host inatteso ${info.address}.`);
    }

    return server;
}

export async function closeExpressTestServer(server: Server | null | undefined): Promise<void> {
    if (!server) return;
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
