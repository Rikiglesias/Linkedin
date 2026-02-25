export class RetryableWorkerError extends Error {
    public readonly code: string;

    constructor(message: string, code: string = 'RETRYABLE') {
        super(message);
        this.name = 'RetryableWorkerError';
        this.code = code;
    }
}

export class ChallengeDetectedError extends Error {
    constructor(message: string = 'Challenge/CAPTCHA rilevato') {
        super(message);
        this.name = 'ChallengeDetectedError';
    }
}

