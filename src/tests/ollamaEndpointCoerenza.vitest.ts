/**
 * Due chiavi di config per lo STESSO server Ollama, e nulla che le tenga allineate.
 *
 * Difetto misurato leggendo la config alla fonte (goal audit-codebase, chat #19):
 * - `OLLAMA_ENDPOINT` (`config/domains.ts:461`, default `http://127.0.0.1:11434`) governa la sonda
 *   del preflight e l'avvio automatico del server (`ollamaLifecycle:51,73`).
 * - `OPENAI_BASE_URL` (`config/domains.ts:267`, default `http://127.0.0.1:11434/v1`) governa la
 *   scelta del provider (`providerRegistry.isOllamaConfigured:115`) ed è l'endpoint verso cui
 *   partono davvero le chiamate (`resolveAiProvider` lo restituisce come `endpoint`).
 *
 * Coi default coincidono, quindi il difetto è invisibile finché qualcuno non sposta Ollama. Se ne
 * cambia una sola, due meccanismi decidono su un endpoint diverso da quello usato: il preflight
 * dichiara «Ollama OK» sondando un server che nessuno chiamerà, e il lifecycle avvia (o si astiene
 * dall'avviare) quello sbagliato. Nessuno dei due se ne accorge — è la classe «verifica la
 * rappresentazione invece della cosa», già a ledger.
 *
 * I path DEVONO poter divergere (`/v1` = API OpenAI-compatible, nudo = API nativa): il confronto è
 * sull'origin, e questi test lo fissano perché non venga stretto a un confronto di URL intere.
 */
import { describe, it, expect } from 'vitest';
import { rilevaDivergenzaEndpointOllama } from '../cli/commands/preflightEnv';

describe('coerenza fra OLLAMA_ENDPOINT e OPENAI_BASE_URL', () => {
    it('i DEFAULT del repo non producono falsi allarmi', () => {
        // Esattamente i due default di config/domains.ts — se qualcuno ne cambia uno solo, questo
        // test cade e costringe a decidere, invece di lasciar divergere le chiavi in silenzio.
        expect(
            rilevaDivergenzaEndpointOllama('http://127.0.0.1:11434', 'http://127.0.0.1:11434/v1'),
        ).toBeNull();
    });

    it('path diversi sullo stesso host NON sono una divergenza', () => {
        expect(rilevaDivergenzaEndpointOllama('http://127.0.0.1:11434/', 'http://127.0.0.1:11434/v1')).toBeNull();
    });

    it('host diverso ⇒ divergenza riportata con ENTRAMBI gli origin', () => {
        expect(
            rilevaDivergenzaEndpointOllama('http://127.0.0.1:11434', 'http://192.168.1.50:11434/v1'),
        ).toEqual({
            origineSonda: 'http://127.0.0.1:11434',
            origineChiamate: 'http://192.168.1.50:11434',
        });
    });

    it('stesso host ma PORTA diversa ⇒ divergenza (sono due server)', () => {
        expect(rilevaDivergenzaEndpointOllama('http://127.0.0.1:11434', 'http://127.0.0.1:8080/v1')).toEqual({
            origineSonda: 'http://127.0.0.1:11434',
            origineChiamate: 'http://127.0.0.1:8080',
        });
    });

    it('URL malformato ⇒ null: non è questo check a doverlo diagnosticare', () => {
        expect(rilevaDivergenzaEndpointOllama('non-un-url', 'http://127.0.0.1:11434/v1')).toBeNull();
        expect(rilevaDivergenzaEndpointOllama('http://127.0.0.1:11434', '')).toBeNull();
    });
});
