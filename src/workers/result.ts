export interface WorkerExecutionError {
    leadId?: number;
    message: string;
}

export interface WorkerExecutionResult {
    success: boolean;
    processedCount: number;
    errors: WorkerExecutionError[];
}

export function workerResult(processedCount: number, errors: WorkerExecutionError[] = []): WorkerExecutionResult {
    return {
        success: errors.length === 0,
        processedCount,
        errors,
    };
}
