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
        // Il guasto vero ha QUESTA direzione: le chiamate vanno al loopback (quindi Ollama È il
        // provider risolto), ma sonda e avvio automatico guardano una macchina in LAN. Il preflight
        // direbbe «Ollama OK» a proposito di un server che nessuno chiamera'.
        // ⚠️ La direzione opposta (OPENAI_BASE_URL remoto) NON e' un guasto: li' Ollama non e' il
        // provider — caso coperto sotto, fra quelli trovati dal critico.
        expect(
            rilevaDivergenzaEndpointOllama('http://192.168.1.50:11434', 'http://127.0.0.1:11434/v1'),
        ).toEqual({
            origineSonda: 'http://192.168.1.50:11434',
            origineChiamate: 'http://127.0.0.1:11434',
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
    // ─── Casi trovati dal critico avversariale (chat #19) ───────────────────────────

    it('localhost e 127.0.0.1 sono LA STESSA macchina, non una divergenza', () => {
        // Regressione: il primo confronto era testuale su `origin` e li dava per server diversi,
        // ricopiando una regola che il repo ha gia' unificato in `isLoopbackAiHost` (config/env.ts).
        expect(rilevaDivergenzaEndpointOllama('http://localhost:11434', 'http://127.0.0.1:11434/v1')).toBeNull();
        expect(rilevaDivergenzaEndpointOllama('http://127.0.0.1:11434', 'http://localhost:11434/v1')).toBeNull();
    });

    it('due loopback su PORTE diverse restano due server', () => {
        expect(rilevaDivergenzaEndpointOllama('http://localhost:11434', 'http://127.0.0.1:8080/v1')).toEqual({
            origineSonda: 'http://localhost:11434',
            origineChiamate: 'http://127.0.0.1:8080',
        });
    });

    it('OPENAI_BASE_URL remoto (OpenAI cloud) NON è una divergenza: Ollama non è il provider', () => {
        // Config DOCUMENTATA in docs/CONFIG_REFERENCE.md (con AI_ALLOW_REMOTE_ENDPOINT=true).
        // Segnalarla darebbe un WARN permanente su un guasto inesistente, a ogni preflight.
        expect(
            rilevaDivergenzaEndpointOllama('http://127.0.0.1:11434', 'https://api.openai.com/v1'),
        ).toBeNull();
    });

    it('endpoint remoto diverso dal locale: comunque nessun allarme se Ollama non è il provider', () => {
        expect(rilevaDivergenzaEndpointOllama('http://192.168.1.50:11434', 'https://api.anthropic.com/v1')).toBeNull();
    });
});
