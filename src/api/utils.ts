import type { Response } from 'express';
import { logError } from '../telemetry/logger';

export interface ApiV1Envelope<TData> {
    apiVersion: 'v1';
    requestId: string;
    timestamp: string;
    data: TData;
}

export function handleApiError(res: Response, err: unknown, context: string): void {
    const message = err instanceof Error ? err.message : String(err);
    // Non espone stack trace né dettagli interni in produzione
    void logError(context, { error: message });
    res.status(500).json({ error: 'Errore interno del server.' });
}

export function sendApiV1<TData>(res: Response, data: TData, statusCode: number = 200): void {
    const payload: ApiV1Envelope<TData> = {
        apiVersion: 'v1',
        requestId: String(res.locals.correlationId ?? ''),
        timestamp: new Date().toISOString(),
        data,
    };
    res.status(statusCode).json(payload);
}
