/**
 * captcha/visionProviderFactory.ts
 * ─────────────────────────────────────────────────────────────────
 * Factory per la creazione del VisionProvider con fallback a 3 livelli:
 *   1. GPT-5.4 (OpenAI) — più accurato, contesto 1M token
 *   2. Ollama locale — fallback se API down o rate limited
 *   3. CSS selectors puri — gestito a livello di caller (non qui)
 *
 * Il layer di astrazione è trasparente: nessun file che usa
 * visionClick/visionVerify/visionWaitFor deve cambiare.
 */

import { logInfo, logWarn } from '../telemetry/logger';
import { OllamaVisionProvider } from './ollamaVisionProvider';
import { BudgetExceededError, OpenAIVisionProvider } from './openaiVisionProvider';
import type {
    Coordinates,
    VisionAnalysisResult,
    VisionProvider,
    VisionProviderConfig,
} from './visionProvider';

/**
 * Provider ibrido che implementa il fallback automatico:
 * GPT-5.4 primary → Ollama fallback.
 * Se GPT-5.4 fallisce (API down, rate limit, budget exceeded),
 * scala automaticamente a Ollama per il resto della richiesta.
 */
class HybridVisionProvider implements VisionProvider {
    readonly name = 'hybrid';
    private primary: OpenAIVisionProvider;
    private fallback: OllamaVisionProvider;
    private primaryFailed = false;

    constructor(primary: OpenAIVisionProvider, fallback: OllamaVisionProvider) {
        this.primary = primary;
        this.fallback = fallback;
    }

    async analyzeImage(base64Image: string, prompt: string): Promise<VisionAnalysisResult> {
        if (!this.primaryFailed) {
            try {
                return await this.primary.analyzeImage(base64Image, prompt);
            } catch (error) {
                if (error instanceof BudgetExceededError) {
                    void logWarn('vision.hybrid.budget_exceeded_fallback', {
                        cost: this.primary.currentSessionCostUsd.toFixed(4),
                    });
                    this.primaryFailed = true;
                } else {
                    void logWarn('vision.hybrid.primary_failed', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    this.primaryFailed = true;
                }
            }
        }
        return this.fallback.analyzeImage(base64Image, prompt);
    }

    async findCoordinates(
        base64Image: string,
        description: string,
        viewportBounds?: { width: number; height: number },
    ): Promise<Coordinates | null> {
        if (!this.primaryFailed) {
            try {
                return await this.primary.findCoordinates(base64Image, description, viewportBounds);
            } catch (error) {
                if (error instanceof BudgetExceededError) {
                    this.primaryFailed = true;
                } else {
                    void logWarn('vision.hybrid.primary_coords_failed', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    this.primaryFailed = true;
                }
            }
        }
        return this.fallback.findCoordinates(base64Image, description, viewportBounds);
    }

    async isAvailable(): Promise<boolean> {
        const primaryOk = await this.primary.isAvailable();
        if (primaryOk) return true;
        return this.fallback.isAvailable();
    }

    /** Espone il provider OpenAI per funzioni avanzate (code harness, timing). */
    getOpenAIProvider(): OpenAIVisionProvider | null {
        return this.primaryFailed ? null : this.primary;
    }

    get sessionCostUsd(): number {
        return this.primary.currentSessionCostUsd;
    }
}

let _cachedProvider: VisionProvider | null = null;
let _cachedConfigHash = '';

function configHash(cfg: VisionProviderConfig): string {
    return `${cfg.provider}:${cfg.ollamaEndpoint}:${cfg.ollamaModel}:${cfg.openaiModel}:${cfg.budgetMaxUsd}`;
}

/**
 * Restituisce la config vision leggendo dalle env vars.
 * Valori di default conservativi: Ollama locale, nessun budget.
 */
export function getVisionConfig(): VisionProviderConfig {
    // Lazy-import to avoid circular dependency at module init
    const { config } = require('../config') as typeof import('../config');
    return {
        provider: config.visionProvider,
        ollamaEndpoint: config.ollamaEndpoint,
        ollamaModel: config.visionModelOllama,
        openaiApiKey: config.openaiApiKey,
        openaiModel: config.visionModelOpenai,
        temperature: config.visionTemperature,
        budgetMaxUsd: config.visionBudgetMaxUsd,
        redactScreenshots: config.visionRedactScreenshots,
    };
}

/**
 * Factory principale: crea il VisionProvider in base alla configurazione.
 * Gestisce il caching: stessa config → stesso provider (singleton).
 */
export function createVisionProvider(overrideConfig?: Partial<VisionProviderConfig>): VisionProvider {
    const cfg = { ...getVisionConfig(), ...overrideConfig };
    const hash = configHash(cfg);

    if (_cachedProvider && _cachedConfigHash === hash) {
        return _cachedProvider;
    }

    let provider: VisionProvider;

    switch (cfg.provider) {
        case 'openai': {
            if (!cfg.openaiApiKey) {
                void logWarn('vision.factory.no_openai_key_fallback_ollama');
                provider = new OllamaVisionProvider({
                    endpoint: cfg.ollamaEndpoint,
                    model: cfg.ollamaModel,
                    temperature: cfg.temperature,
                });
            } else {
                provider = new OpenAIVisionProvider({
                    apiKey: cfg.openaiApiKey,
                    model: cfg.openaiModel,
                    temperature: cfg.temperature,
                    budgetMaxUsd: cfg.budgetMaxUsd,
                    redactScreenshots: cfg.redactScreenshots,
                });
            }
            break;
        }
        case 'ollama': {
            provider = new OllamaVisionProvider({
                endpoint: cfg.ollamaEndpoint,
                model: cfg.ollamaModel,
                temperature: cfg.temperature,
            });
            break;
        }
        case 'auto':
        default: {
            if (cfg.openaiApiKey) {
                const primary = new OpenAIVisionProvider({
                    apiKey: cfg.openaiApiKey,
                    model: cfg.openaiModel,
                    temperature: cfg.temperature,
                    budgetMaxUsd: cfg.budgetMaxUsd,
                    redactScreenshots: cfg.redactScreenshots,
                });
                const fallback = new OllamaVisionProvider({
                    endpoint: cfg.ollamaEndpoint,
                    model: cfg.ollamaModel,
                    temperature: cfg.temperature,
                });
                provider = new HybridVisionProvider(primary, fallback);
            } else {
                provider = new OllamaVisionProvider({
                    endpoint: cfg.ollamaEndpoint,
                    model: cfg.ollamaModel,
                    temperature: cfg.temperature,
                });
            }
            break;
        }
    }

    void logInfo('vision.factory.provider_created', {
        type: cfg.provider,
        actualProvider: provider.name,
        model: cfg.provider === 'ollama' ? cfg.ollamaModel : cfg.openaiModel,
        budgetMaxUsd: cfg.budgetMaxUsd,
        redact: cfg.redactScreenshots,
    });

    _cachedProvider = provider;
    _cachedConfigHash = hash;
    return provider;
}

/**
 * Resetta il provider cached. Utile per test o cambio config runtime.
 */
export function resetVisionProvider(): void {
    _cachedProvider = null;
    _cachedConfigHash = '';
}

/**
 * Estrae l'OpenAIVisionProvider dal provider corrente (se disponibile).
 * Usato per funzionalità avanzate: code harness, contextual timing.
 */
export function getOpenAIProviderFromCurrent(): OpenAIVisionProvider | null {
    if (!_cachedProvider) return null;
    if (_cachedProvider instanceof OpenAIVisionProvider) return _cachedProvider;
    if (_cachedProvider instanceof HybridVisionProvider) return _cachedProvider.getOpenAIProvider();
    return null;
}

/**
 * Restituisce il costo stimato della sessione corrente (USD).
 */
export function getSessionCostUsd(): number {
    if (!_cachedProvider) return 0;
    if (_cachedProvider instanceof HybridVisionProvider) return _cachedProvider.sessionCostUsd;
    if (_cachedProvider instanceof OpenAIVisionProvider) return _cachedProvider.currentSessionCostUsd;
    return 0;
}
