import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { logError } from '../telemetry/logger';

export interface VisionSolverOptions {
    model?: string;
    endpoint?: string;
    temperature?: number;
}

export interface Coordinates {
    x: number;
    y: number;
}

/**
 * Modello Visione Locale basato su Ollama (es. LLaVA).
 * Implementazione P1-06 per risolvere CAPTCHA via computer vision e
 * fornire un fallback visivo P3-06 per la navigazione UI.
 */
export class VisionSolver {
    private endpoint: string;
    private model: string;
    private temperature: number;

    constructor(options?: VisionSolverOptions) {
        this.endpoint = options?.endpoint ?? process.env.OLLAMA_ENDPOINT ?? 'http://127.0.0.1:11434';
        this.model = options?.model ?? process.env.VISION_MODEL ?? 'llava';
        this.temperature = options?.temperature ?? 0.1; // Bassa "creatività" = maggiore fedeltà ai pixel
    }

    /**
     * Sottopone un'immagine al Vision Model e restiuisce l'output raw testuale.
     * @param base64Image L'immagine decodificata base64 (senza intestazione data URI)
     * @param prompt Il prompt per il modello (es. "Risolvi il captcha", "leggi il testo")
     */
    public async analyzeImage(base64Image: string, prompt: string): Promise<string> {
        const payload = {
            model: this.model,
            prompt: prompt,
            images: [base64Image],
            stream: false,
            options: {
                temperature: this.temperature,
            },
        };

        const response = await fetchWithRetryPolicy(
            `${this.endpoint}/api/generate`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            {
                integration: 'vision.ollama',
                circuitKey: 'vision.api',
                timeoutMs: 45_000,
                maxAttempts: 2,
            },
        );

        if (!response.ok) {
            throw new Error(`Vision API error: HTTP ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as { response: string };
        return data.response;
    }

    /**
     * Usa la visione per dedurre la posizione X,Y di un oggetto semantico,
     * utilissimo per i grid CAPTCHA o per riconoscere bottoni invisibili ai selettori standard.
     */
    public async findObjectCoordinates(base64Image: string, targetObject: string): Promise<Coordinates | null> {
        const prompt = `Analizza accuratamente questa immagine. Trova l'oggetto "${targetObject}". 
Rispondi ESCLUSIVAMENTE compilando questo JSON valido e senza spiegazioni aggiuntive: {"x": coordinate_x, "y": coordinate_y} rappresentante il centro pixel approssimativo dell'oggetto richiesto.`;

        const rawResponse = await this.analyzeImage(base64Image, prompt);

        try {
            // Estrazione regex robusta nel caso il VLM faccia prepending o includa backticks
            const jsonMatch = rawResponse.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
                if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
                    return { x: parsed.x, y: parsed.y };
                }
            }
        } catch (error: unknown) {
            void logError('vision_solver.json_parse_failed', {
                rawResponse: rawResponse.substring(0, 200),
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return null;
    }
}
