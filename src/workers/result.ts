export interface WorkerExecutionError {
    leadId?: number;
    message: string;
}

export interface WorkerExecutionResult {
    success: boolean;
    processedCount: number;
    errors: WorkerExecutionError[];
    /** True se il vision fallback (GPT/Ollama coordinate-based) è stato usato al posto dei CSS selectors */
    visionFallbackUsed?: boolean;
}

export function workerResult(processedCount: number, errors: WorkerExecutionError[] = []): WorkerExecutionResult {
    return {
        success: errors.length === 0,
        processedCount,
        errors,
    };
}
