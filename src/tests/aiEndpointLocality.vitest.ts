/**
 * F-a3f17c02 — la regola «questo endpoint AI è in casa?» esisteva in TRE copie divergenti
 * (`ai/openaiClient.ts`, `config/env.ts`, `ai/providerRegistry.ts:isLocalUrl`) e lo stesso URL
 * riceveva tre verdetti diversi, senza che nessuno lo segnalasse:
 *   - `http://[::1]:11434/v1`  → client SÌ, registry NO ⇒ Ollama locale via IPv6 accettato dal
 *     client ma invisibile al registry ⇒ i 7 purpose PII-sensitive cadono su `template`, che LANCIA.
 *   - `http://0.0.0.0:11434/v1` → validation SÌ, client NO ⇒ config dichiarata valida e il 100%
 *     delle chiamate bloccato a runtime da `aiAllowRemoteEndpoint`.
 * Questo file fissa la tabella di verità UNICA e vieta strutturalmente che la regola torni a
 * essere ricopiata altrove.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isLocalAiEndpoint, isLoopbackAiHost, isAiRequestConfigured } from '../config/env';

const { mockConfig, mockState } = vi.hoisted(() => ({
    mockConfig: {
        aiPersonalizationEnabled: true,
        openaiApiKey: '',
        openaiBaseUrl: 'http://[::1]:11434/v1',
        aiModel: 'qwen3:8b',
        aiGreenModel: 'qwen3:8b',
        aiAllowRemoteEndpoint: true,
        ollamaFallbackUrl: '',
        aiProvider: 'auto' as string,
        anthropicApiKey: '',
        anthropicModel: 'claude-opus-4-8',
        anthropicModelLight: 'claude-haiku-4-5-20251001',
    },
    mockState: { greenMode: false },
}));

vi.mock('../config', () => ({
    config: mockConfig,
    isGreenModeWindow: () => mockState.greenMode,
}));
vi.mock('../ai/openaiClient', () => ({ isOpenAIConfigured: () => true }));
vi.mock('../ai/anthropicClient', () => ({ isAnthropicConfigured: () => false }));
vi.mock('../core/integrationPolicy', () => ({ isCircuitOpenForKey: () => false }));

describe('locality dell endpoint AI — definizione UNICA (F-a3f17c02)', () => {
    describe('isLoopbackAiHost — perimetro STRETTO, decide chi riceve la chiave', () => {
        it.each([
            ['http://localhost:11434/v1', true],
            ['http://127.0.0.1:11434/v1', true],
            // 127.0.0.0/8 è interamente loopback (RFC 1122): 127.0.0.2 è la stessa macchina.
            ['http://127.0.0.2:11434/v1', true],
            // Serializzazione WHATWG: `new URL('http://[::1]').hostname` vale '[::1]', CON le
            // parentesi. Confrontarlo con '::1' era codice morto in due copie su tre.
            ['http://[::1]:11434/v1', true],
            // IPv4-mapped: WHATWG comprime in esadecimale ⇒ hostname reale '[::ffff:7f00:1]'.
            // Il confronto letterale con '::ffff:127.0.0.1' di config/env.ts NON poteva matchare.
            ['http://[::ffff:127.0.0.1]:11434/v1', true],
            ['http://[::ffff:7f00:1]:11434/v1', true],
            // Wildcard-bind: come DESTINAZIONE di un client i SO la instradano al loopback.
            ['http://0.0.0.0:11434/v1', true],
            // mDNS = un host QUALSIASI della LAN: non è la macchina corrente.
            ['http://nas.local:11434/v1', false],
            ['https://api.openai.com/v1', false],
            ['http://192.168.1.50:11434/v1', false],
            ['non-un-url', false],
        ])('%s → %s', (url, atteso) => {
            expect(isLoopbackAiHost(url)).toBe(atteso);
        });
    });

    describe('isLocalAiEndpoint — perimetro LARGO (loopback + mDNS), decide «è in casa»', () => {
        it.each([
            ['http://[::1]:11434/v1', true],
            ['http://0.0.0.0:11434/v1', true],
            ['http://[::ffff:127.0.0.1]:11434/v1', true],
            ['http://127.0.0.2:11434/v1', true],
            ['http://nas.local:11434/v1', true],
            ['https://api.openai.com/v1', false],
            ['http://192.168.1.50:11434/v1', false],
        ])('%s → %s', (url, atteso) => {
            expect(isLocalAiEndpoint(url)).toBe(atteso);
        });

        it('è un SOVRAINSIEME del loopback stretto, mai il contrario', () => {
            const urls = [
                'http://localhost:1',
                'http://127.0.0.1:1',
                'http://[::1]:1',
                'http://0.0.0.0:1',
                'http://nas.local:1',
                'https://api.openai.com',
            ];
            for (const url of urls) {
                if (isLoopbackAiHost(url)) expect(isLocalAiEndpoint(url)).toBe(true);
            }
        });
    });

    it('isAiRequestConfigured segue la SSOT: loopback IPv6 senza chiave è configurato', () => {
        expect(isAiRequestConfigured('http://[::1]:11434/v1', '')).toBe(true);
        expect(isAiRequestConfigured('http://0.0.0.0:11434/v1', '')).toBe(true);
        expect(isAiRequestConfigured('https://api.openai.com/v1', '')).toBe(false);
        expect(isAiRequestConfigured('https://api.openai.com/v1', 'sk-x')).toBe(true);
    });

    describe('il registry vede la stessa cosa del client', () => {
        beforeEach(() => {
            mockConfig.openaiBaseUrl = 'http://[::1]:11434/v1';
            mockConfig.aiProvider = 'auto';
            mockConfig.aiAllowRemoteEndpoint = true;
            mockState.greenMode = false;
        });

        it('Ollama su loopback IPv6 è disponibile per i purpose PII (non cade su template)', async () => {
            const { resolveAiProvider } = await import('../ai/providerRegistry');
            const esito = resolveAiProvider('invite_note');
            expect(esito.piiSensitive).toBe(true);
            // Prima del fix: 'template' / 'pii_cloud_blocked_no_local' — l'AI PII moriva in silenzio.
            expect(esito.provider).toBe('ollama');
        });

        it('Ollama su 0.0.0.0 è disponibile per i purpose PII', async () => {
            mockConfig.openaiBaseUrl = 'http://0.0.0.0:11434/v1';
            const { resolveAiProvider } = await import('../ai/providerRegistry');
            expect(resolveAiProvider('invite_note').provider).toBe('ollama');
        });

        it('il cloud resta cloud: purpose PII senza locale cade su template', async () => {
            mockConfig.openaiBaseUrl = 'https://api.openai.com/v1';
            const { resolveAiProvider } = await import('../ai/providerRegistry');
            expect(resolveAiProvider('invite_note').provider).toBe('template');
        });
    });

    /**
     * Perimetro: `ai/` e `config/`, cioè il dominio della domanda «dove mando le richieste AI».
     * Fuori restano DUE classi che la prima versione di questa guardia segnalava e che sono state
     * verificate una per una, non liquidate in blocco:
     *  - `security/ssrfGuard.ts` risponde alla domanda OPPOSTA (loopback = da BLOCCARE). Unificarla
     *    con questa allow-list la corromperebbe al primo cambio di perimetro.
     *  - `api/helpers/requestIp.ts` e `api/server.ts` normalizzano l'IP di CHI CHIAMA NOI: altro
     *    dominio. Sono però due copie identiche fra loro — duplicazione vera, di un'altra classe,
     *    tracciata in `~/todos/improvements-proposed.md` invece di essere risolta di straforo qui.
     */
    it('GUARDIA STRUTTURALE: la regola loopback non è ricopiata fuori dalla SSOT', () => {
        const radice = path.resolve(__dirname, '..');
        const ssot = path.join(radice, 'config', 'env.ts');
        const colpevoli: string[] = [];

        const cammina = (dir: string): void => {
            for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
                const completo = path.join(dir, voce.name);
                if (voce.isDirectory()) {
                    cammina(completo);
                    continue;
                }
                if (!voce.name.endsWith('.ts') || completo === ssot) continue;
                const righe = fs.readFileSync(completo, 'utf8').split('\n');
                righe.forEach((riga, i) => {
                    // Le righe di commento non contano: una guardia resa verde togliendole la vista
                    // sarebbe un fallimento travestito da fix.
                    const codice = riga.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
                    if (/===\s*'(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)'/.test(codice)) {
                        colpevoli.push(`${path.relative(radice, completo).replace(/\\/g, '/')}:${i + 1}`);
                    }
                });
            }
        };
        cammina(path.join(radice, 'ai'));
        cammina(path.join(radice, 'config'));

        // Prima del fix: ai/openaiClient.ts, ai/providerRegistry.ts e ai/ollamaLifecycle.ts.
        expect(colpevoli).toEqual([]);
    });
});
