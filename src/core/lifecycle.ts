type ShutdownCallback = () => Promise<void>;

const callbacks: ShutdownCallback[] = [];

let _shuttingDown = false;

export function setShuttingDown(): void {
    _shuttingDown = true;
}

export function isShuttingDown(): boolean {
    return _shuttingDown;
}

export function onShutdown(fn: ShutdownCallback): void {
    callbacks.push(fn);
}

export async function runShutdownCallbacks(): Promise<void> {
    for (const fn of callbacks) {
        try {
            await fn();
        } catch (err) {
            console.error('[SHUTDOWN] Callback error:', err);
        }
    }
    callbacks.length = 0;
}
