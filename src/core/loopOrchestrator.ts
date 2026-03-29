/**
 * core/loopOrchestrator.ts
 * ─────────────────────────────────────────────────────────────────
 * Framework per decomporre il run-loop in sub-task orchestrati.
 *
 * Ogni sub-task dichiara:
 * - name: identificativo per logging
 * - shouldRun(ctx): predicato asincrono — il task esegue solo se true
 * - execute(ctx): logica del task
 * - onError: 'skip' (il ciclo continua) o 'abort' (il ciclo si interrompe)
 */

export interface LoopCycleContext {
    cycle: number;
    localDate: string;
    workflow: string;
    dryRun: boolean;
    isLeader: boolean;
}

export interface LoopSubTask {
    name: string;
    shouldRun: (ctx: LoopCycleContext) => Promise<boolean> | boolean;
    execute: (ctx: LoopCycleContext) => Promise<void>;
    onError: 'skip' | 'abort';
}

export interface LoopCycleResult {
    tasksRun: string[];
    tasksSkipped: string[];
    tasksErrored: Array<{ name: string; error: string }>;
    aborted: boolean;
}

/**
 * Esegue tutti i sub-task registrati in ordine.
 * - `skip`: logga l'errore e continua con il task successivo
 * - `abort`: logga l'errore e interrompe il ciclo
 */
export async function runLoopCycle(tasks: readonly LoopSubTask[], ctx: LoopCycleContext): Promise<LoopCycleResult> {
    const result: LoopCycleResult = {
        tasksRun: [],
        tasksSkipped: [],
        tasksErrored: [],
        aborted: false,
    };

    const totalTasks = tasks.length;
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        try {
            const shouldRun = await task.shouldRun(ctx);
            if (!shouldRun) {
                result.tasksSkipped.push(task.name);
                continue;
            }

            // C14: Logging fasi numerate — l'utente vede esattamente dove è il ciclo.
            console.log(`[LOOP] Fase ${i + 1}/${totalTasks}: ${task.name}`);
            await task.execute(ctx);
            result.tasksRun.push(task.name);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.tasksErrored.push({ name: task.name, error: message });
            console.error(`[LOOP] task "${task.name}" failed: ${message}`);

            if (task.onError === 'abort') {
                result.aborted = true;
                break;
            }
        }
    }

    return result;
}
