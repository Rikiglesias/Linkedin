/**
 * captcha/ollamaVisionProvider.ts
 * ─────────────────────────────────────────────────────────────────
 * VisionProvider locale basato su Ollama (LLaVA / llava-llama3).
 * Wrappa la classe VisionSolver esistente dietro l'interfaccia unificata.
 */

import { VisionSolver } from './solver';
import type { Coordinates, VisionAnalysisResult, VisionProvider } from './visionProvider';

export class OllamaVisionProvider implements VisionProvider {
    readonly name = 'ollama';
    private solver: VisionSolver;

    constructor(options?: { endpoint?: string; model?: string; temperature?: number }) {
        this.solver = new VisionSolver(options);
    }

    async analyzeImage(base64Image: string, prompt: string): Promise<VisionAnalysisResult> {
        const text = await this.solver.analyzeImage(base64Image, prompt);
        return { text, provider: 'ollama' };
    }

    async findCoordinates(
        base64Image: string,
        description: string,
        viewportBounds?: { width: number; height: number },
    ): Promise<Coordinates | null> {
        return this.solver.findObjectCoordinates(base64Image, description, viewportBounds);
    }

    async isAvailable(): Promise<boolean> {
        try {
            const endpoint =
                this.solver['endpoint'] ?? process.env.OLLAMA_ENDPOINT ?? 'http://127.0.0.1:11434';
            const response = await fetch(`${endpoint}/api/tags`, {
                signal: AbortSignal.timeout(3_000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}
