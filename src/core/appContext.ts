/**
 * core/appContext.ts
 * Dependency Injection leggera: AppContext contiene le dipendenze principali
 * dell'applicazione passate esplicitamente invece che importate direttamente.
 *
 * Vantaggi:
 * - Testabilità: i test possono iniettare mock di DB, config, logger
 * - Separazione: i moduli non dipendono da singleton globali
 * - Chiarezza: le dipendenze di ogni funzione sono esplicite nella firma
 *
 * Strategia di adozione INCREMENTALE:
 * 1. Questo file definisce il tipo e la factory
 * 2. I nuovi moduli/funzioni accettano `ctx?: AppContext` come ultimo parametro opzionale
 * 3. Se `ctx` non è fornito, usano i singleton globali (retrocompatibilità totale)
 * 4. I test passano un AppContext mockato
 * 5. Migrazione progressiva: quando un file viene toccato per altre ragioni, si aggiunge `ctx?`
 */

import type { DatabaseManager } from '../db';
import type { AppConfig } from '../config/types';

export interface AppLogger {
    info(event: string, data?: Record<string, unknown>): Promise<void>;
    warn(event: string, data?: Record<string, unknown>): Promise<void>;
    error(event: string, data?: Record<string, unknown>): Promise<void>;
}

export interface AppContext {
    db: DatabaseManager;
    config: AppConfig;
    logger: AppLogger;
}

/**
 * Crea un AppContext dai singleton globali dell'applicazione.
 * Usato al boot per creare il contesto di default.
 */
export async function createDefaultAppContext(): Promise<AppContext> {
    const { getDatabase } = await import('../db');
    const { config } = await import('../config');
    const { logInfo, logWarn, logError } = await import('../telemetry/logger');

    return {
        db: await getDatabase(),
        config,
        logger: {
            info: logInfo,
            warn: logWarn,
            error: logError,
        },
    };
}

/**
 * Helper per test: crea un AppContext con mock.
 * Il DB mock deve implementare l'interfaccia DatabaseManager.
 */
export function createTestAppContext(overrides: Partial<AppContext>): AppContext {
    const noopLogger: AppLogger = {
        info: async () => {},
        warn: async () => {},
        error: async () => {},
    };

    return {
        db: overrides.db ?? ({} as DatabaseManager),
        config: overrides.config ?? ({} as AppConfig),
        logger: overrides.logger ?? noopLogger,
    };
}
