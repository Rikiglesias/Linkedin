/**
 * frontend/i18n.ts
 * ─────────────────────────────────────────────────────────────────
 * Minimal i18n for the dashboard.
 * Two locales: 'it' (default) and 'en'.
 * Usage: t('kpi.invited')  → "Invitati" / "Invited"
 *        t('status.paused_until', { time: '14:30' })  → "Pausato fino alle 14:30"
 */

export type Locale = 'it' | 'en';

type TranslationMap = Record<string, string>;

const IT: TranslationMap = {
    // Header
    'header.title': 'LinkedIn Bot — Dashboard',
    'header.refresh': 'Aggiorna',
    'header.theme': 'Tema',
    'header.csv': 'CSV',
    'header.png': 'PNG',
    'header.print': 'Stampa',
    'header.run': 'Run',
    'header.pause': 'Pausa',
    'header.resume': 'Riprendi',

    // KPI cards
    'kpi.invited': 'Invitati',
    'kpi.accepted': 'Accettati',
    'kpi.ready_message': 'Ready Message',
    'kpi.messaged': 'Messaggiati',
    'kpi.replied': 'Risposte',
    'kpi.risk': 'Rischio',
    'kpi.total': 'Totale Lead',

    // Status
    'status.running': 'Operativo',
    'status.paused_until': 'Pausato fino alle {time}',
    'status.quarantine': 'Quarantena attiva',

    // Charts
    'chart.invites_per_day': 'Inviti / giorno',
    'chart.health': 'Salute',

    // Sections
    'section.conversion': 'Snapshot Conversione',
    'section.kpi_compare': 'KPI Confronto',
    'section.timeline': 'Timeline',
    'section.incidents': 'Incidenti',
    'section.review_queue': 'Coda Revisione',
    'section.ab_testing': 'A/B Testing',
    'section.timing': 'Timing Ottimale',
    'section.comments': 'Suggerimenti Commenti AI',
    'section.runs': 'Run Recenti',
    'section.lead_search': 'Ricerca Lead',

    // Conversion metrics
    'conv.accept_rate': 'Tasso di Accettazione',
    'conv.reply_rate': 'Tasso di Risposta',
    'conv.system_state': 'Stato Sistema',
    'conv.predictive_risk': 'Rischio Predittivo',
    'conv.review_queue': 'Coda Revisione',

    // Incidents
    'incident.resolve': 'Risolvi',
    'incident.resolve_selected': 'Risolvi selezionati',
    'incident.no_open': 'Nessun incidente aperto',

    // Lead search
    'lead.search_placeholder': 'Cerca per nome, azienda, URL...',
    'lead.no_results': 'Nessun risultato',
    'lead.status': 'Stato',
    'lead.name': 'Nome',
    'lead.company': 'Azienda',
    'lead.score': 'Score',
    'lead.list': 'Lista',
    'lead.updated': 'Aggiornato',

    // Controls
    'ctrl.pause_minutes': 'Minuti di pausa',
    'ctrl.confirm': 'Conferma',
    'ctrl.cancel': 'Annulla',

    // Shortcuts
    'shortcut.title': 'Scorciatoie Tastiera',
    'shortcut.refresh': 'Aggiorna dati',
    'shortcut.theme': 'Cambia tema',
    'shortcut.export': 'Esporta CSV',
    'shortcut.print': 'Stampa report',
    'shortcut.help': 'Mostra aiuto',
    'shortcut.close': 'Chiudi modale',

    // Time
    'time.today': 'Oggi',
    'time.this_week': 'Settimana',
    'time.day_vs_week': 'Giorno vs Settimana',

    // Misc
    'misc.last_refresh': 'Ultimo aggiornamento',
    'misc.loading': 'Caricamento...',
    'misc.error': 'Errore',
    'misc.no_data': 'Nessun dato disponibile',
};

const EN: TranslationMap = {
    // Header
    'header.title': 'LinkedIn Bot — Dashboard',
    'header.refresh': 'Refresh',
    'header.theme': 'Theme',
    'header.csv': 'CSV',
    'header.png': 'PNG',
    'header.print': 'Print',
    'header.run': 'Run',
    'header.pause': 'Pause',
    'header.resume': 'Resume',

    // KPI cards
    'kpi.invited': 'Invited',
    'kpi.accepted': 'Accepted',
    'kpi.ready_message': 'Ready Message',
    'kpi.messaged': 'Messaged',
    'kpi.replied': 'Replied',
    'kpi.risk': 'Risk',
    'kpi.total': 'Total Leads',

    // Status
    'status.running': 'Running',
    'status.paused_until': 'Paused until {time}',
    'status.quarantine': 'Quarantine active',

    // Charts
    'chart.invites_per_day': 'Invites / day',
    'chart.health': 'Health',

    // Sections
    'section.conversion': 'Conversion Snapshot',
    'section.kpi_compare': 'KPI Comparison',
    'section.timeline': 'Timeline',
    'section.incidents': 'Incidents',
    'section.review_queue': 'Review Queue',
    'section.ab_testing': 'A/B Testing',
    'section.timing': 'Optimal Timing',
    'section.comments': 'AI Comment Suggestions',
    'section.runs': 'Recent Runs',
    'section.lead_search': 'Lead Search',

    // Conversion metrics
    'conv.accept_rate': 'Accept Rate',
    'conv.reply_rate': 'Reply Rate',
    'conv.system_state': 'System State',
    'conv.predictive_risk': 'Predictive Risk',
    'conv.review_queue': 'Review Queue',

    // Incidents
    'incident.resolve': 'Resolve',
    'incident.resolve_selected': 'Resolve selected',
    'incident.no_open': 'No open incidents',

    // Lead search
    'lead.search_placeholder': 'Search by name, company, URL...',
    'lead.no_results': 'No results',
    'lead.status': 'Status',
    'lead.name': 'Name',
    'lead.company': 'Company',
    'lead.score': 'Score',
    'lead.list': 'List',
    'lead.updated': 'Updated',

    // Controls
    'ctrl.pause_minutes': 'Pause minutes',
    'ctrl.confirm': 'Confirm',
    'ctrl.cancel': 'Cancel',

    // Shortcuts
    'shortcut.title': 'Keyboard Shortcuts',
    'shortcut.refresh': 'Refresh data',
    'shortcut.theme': 'Toggle theme',
    'shortcut.export': 'Export CSV',
    'shortcut.print': 'Print report',
    'shortcut.help': 'Show help',
    'shortcut.close': 'Close modal',

    // Time
    'time.today': 'Today',
    'time.this_week': 'This Week',
    'time.day_vs_week': 'Day vs Week',

    // Misc
    'misc.last_refresh': 'Last refresh',
    'misc.loading': 'Loading...',
    'misc.error': 'Error',
    'misc.no_data': 'No data available',
};

const LOCALE_MAP: Record<Locale, TranslationMap> = { it: IT, en: EN };

const LOCALE_STORAGE_KEY = 'lkbot_locale';

let currentLocale: Locale = detectLocale();

function detectLocale(): Locale {
    try {
        const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (stored === 'it' || stored === 'en') return stored;
    } catch {
        // localStorage may not be available
    }
    const nav = navigator.language.toLowerCase();
    if (nav.startsWith('it')) return 'it';
    return 'en';
}

/**
 * Translate a key, optionally interpolating `{param}` placeholders.
 *
 * @example t('status.paused_until', { time: '14:30' })
 */
export function t(key: string, params?: Record<string, string | number>): string {
    const map = LOCALE_MAP[currentLocale];
    let text = map[key] ?? LOCALE_MAP.it[key] ?? key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, String(v));
        }
    }
    return text;
}

/** Get current locale. */
export function getLocale(): Locale {
    return currentLocale;
}

/** Set locale and persist to localStorage. */
export function setLocale(locale: Locale): void {
    currentLocale = locale;
    try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
        // ignore
    }
}

/** Toggle between IT and EN. Returns the new locale. */
export function toggleLocale(): Locale {
    const next: Locale = currentLocale === 'it' ? 'en' : 'it';
    setLocale(next);
    return next;
}
