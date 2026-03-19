import { describe, it, expect } from 'vitest';
import { workerResult } from '../workers/result';
import { RetryableWorkerError, ChallengeDetectedError } from '../workers/errors';

describe('workers/result — workerResult', () => {
    it('processedCount=0 → success=true, errors vuoto', () => {
        const r = workerResult(0);
        expect(r.success).toBe(true);
        expect(r.processedCount).toBe(0);
        expect(r.errors).toEqual([]);
    });

    it('processedCount=5 → success=true', () => {
        const r = workerResult(5);
        expect(r.success).toBe(true);
        expect(r.processedCount).toBe(5);
    });

    it('con errori → success=false', () => {
        const r = workerResult(3, [{ message: 'test error' }]);
        expect(r.success).toBe(false);
        expect(r.errors).toHaveLength(1);
    });

    it('errori vuoti → success=true', () => {
        const r = workerResult(2, []);
        expect(r.success).toBe(true);
    });
});

describe('workers/errors', () => {
    it('RetryableWorkerError ha message e code', () => {
        const err = new RetryableWorkerError('test message', 'TEST_CODE');
        expect(err.message).toBe('test message');
        expect(err.code).toBe('TEST_CODE');
        expect(err instanceof Error).toBe(true);
    });

    it('RetryableWorkerError senza code esplicito → default RETRYABLE', () => {
        const err = new RetryableWorkerError('test');
        expect(err.message).toBe('test');
        expect(err.code).toBe('RETRYABLE');
    });

    it('ChallengeDetectedError è un Error', () => {
        const err = new ChallengeDetectedError();
        expect(err instanceof Error).toBe(true);
        expect(err.message).toBeTruthy();
    });

    it('ChallengeDetectedError con messaggio custom', () => {
        const err = new ChallengeDetectedError('CAPTCHA rilevato');
        expect(err.message).toBe('CAPTCHA rilevato');
    });
});
