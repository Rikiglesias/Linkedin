/**
 * IPlugin.ts — Interfaccia del Sistema di Plugin
 *
 * Definisce il contratto che ogni plugin esterno deve implementare.
 * Tutti i metodi sono opzionali: il loader li chiama solo se definiti.
 *
 * Uso minimo di un plugin:
 *
 *   // my-plugin/index.ts
 *   import { IPlugin } from '../../src/plugins/IPlugin';
 *   const plugin: IPlugin = {
 *     name: 'my-plugin',
 *     version: '1.0.0',
 *     async onInviteSent(lead) { ... }
 *   };
 *   export default plugin;
 */

// ─── Tipi helper condivisi ────────────────────────────────────────────────────

export interface PluginLeadSnapshot {
    id: number;
    linkedinUrl: string;
    fullName?: string | null;
    company?: string | null;
    status: string;
    leadScore?: number | null;
}

export interface PluginDailyStats {
    date: string;
    invited: number;
    accepted: number;
    messaged: number;
    replied: number;
    acceptRate: number;  // 0–1
    replyRate: number;   // 0–1
}

export interface PluginMessageEvent {
    leadId: number;
    linkedinUrl: string;
    message: string;
    direction: 'inbound' | 'outbound';
    intent?: string;
    subIntent?: string;
}

// ─── Interfaccia Plugin ───────────────────────────────────────────────────────

export interface IPlugin {
    /** Nome univoco del plugin. */
    readonly name: string;

    /** Versione semver del plugin. */
    readonly version: string;

    /**
     * Chiamato all'avvio del bot, dopo l'inizializzazione del DB.
     * Usare per setup iniziale del plugin (es. creare tabelle custom).
     */
    onInit?(): Promise<void>;

    /**
     * Chiamato ogni volta che un invito viene inviato con successo.
     */
    onInviteSent?(lead: PluginLeadSnapshot, variantId?: string): Promise<void>;

    /**
     * Chiamato quando una connessione viene accettata.
     */
    onInviteAccepted?(lead: PluginLeadSnapshot): Promise<void>;

    /**
     * Chiamato dopo ogni messaggio inviato o ricevuto.
     */
    onMessage?(event: PluginMessageEvent): Promise<void>;

    /**
     * Chiamato quando viene ricevuta una risposta da un lead.
     */
    onReplyReceived?(lead: PluginLeadSnapshot, message: string, intent?: string): Promise<void>;

    /**
     * Chiamato alla generazione del report giornaliero.
     * Il plugin può inviare notifiche custom, esportare dati, ecc.
     */
    onDailyReport?(stats: PluginDailyStats): Promise<void>;

    /**
     * Chiamato alla chiusura del bot. Usare per cleanup.
     */
    onShutdown?(): Promise<void>;
}
