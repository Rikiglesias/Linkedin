/**
 * captcha/visionProvider.ts
 * ─────────────────────────────────────────────────────────────────
 * Interfaccia astratta per i provider di visione AI.
 * Due implementazioni: OllamaVisionProvider (locale) e OpenAIVisionProvider (GPT-5.4).
 * Factory createVisionProvider() sceglie automaticamente in base alla config.
 */

export interface Coordinates {
    x: number;
    y: number;
}

export interface VisionProviderConfig {
    /** 'auto' = GPT-5.4 primary → Ollama fallback. 'local-first' = Ollama primary → OpenAI fallback. 'openai' = solo GPT-5.4. 'ollama' = solo locale. */
    provider: 'auto' | 'local-first' | 'openai' | 'ollama';
    /** Ollama endpoint (default: http://127.0.0.1:11434) */
    ollamaEndpoint: string;
    /** Ollama model (default: llava-llama3:8b) */
    ollamaModel: string;
    /** OpenAI API key */
    openaiApiKey: string;
    /** OpenAI model (default: gpt-4o) */
    openaiModel: string;
    /** Temperature for vision queries (default: 0.1) */
    temperature: number;
    /** Max budget USD per session (0 = unlimited) */
    budgetMaxUsd: number;
    /** Whether to blur sensitive areas before sending to OpenAI */
    redactScreenshots: boolean;
}

export interface VisionAnalysisResult {
    text: string;
    provider: 'openai' | 'ollama';
    estimatedCostUsd?: number;
}

/**
 * Interfaccia unificata per l'analisi di immagini tramite AI vision.
 * Ogni provider implementa questi due metodi core.
 */
export interface VisionProvider {
    readonly name: string;

    /**
     * Analizza un'immagine e restituisce l'output testuale.
     * @param base64Image Immagine base64 (senza header data URI)
     * @param prompt Prompt per il modello
     */
    analyzeImage(base64Image: string, prompt: string): Promise<VisionAnalysisResult>;

    /**
     * Trova le coordinate X,Y di un oggetto semantico nell'immagine.
     * @param base64Image Immagine base64
     * @param description Descrizione dell'oggetto da trovare
     * @param viewportBounds Limiti viewport per clamp
     */
    findCoordinates(
        base64Image: string,
        description: string,
        viewportBounds?: { width: number; height: number },
    ): Promise<Coordinates | null>;

    /**
     * Verifica se il provider è disponibile (health check).
     */
    isAvailable(): Promise<boolean>;
}
