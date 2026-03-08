import type { Response } from 'express';
import { ZodError } from 'zod';
import { logError } from '../telemetry/logger';

export interface ApiV1Envelope<TData> {
    apiVersion: 'v1';
    requestId: string;
    timestamp: string;
    data: TData;
}

export interface ApiErrorBody {
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}

export function handleApiError(res: Response, err: unknown, context: string): void {
    if (err instanceof ZodError) {
        const issues = err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
        }));
        const body: ApiErrorBody = {
            error: { code: 'VALIDATION_ERROR', message: 'Input non valido', details: issues },
        };
        res.status(400).json(body);
        return;
    }

    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    void logError(context, { error: message, stack });
    const body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Errore interno del server.' } };
    res.status(500).json(body);
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
