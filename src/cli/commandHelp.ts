/**
 * commandHelp.ts — Per-command help registry
 *
 * Ogni comando ha usage, descrizione, opzioni ed esempi.
 * Intercettato in index.ts quando l'utente passa --help o -h.
 */

interface CommandOption {
    flag: string;
    description: string;
    default?: string;
}

interface CommandHelp {
    usage: string;
    description: string;
    options: CommandOption[];
    examples: string[];
}

const COMMAND_HELP: Record<string, CommandHelp> = {
    run: {
        usage: 'run [invite|check|message|warmup|all] [--dry-run]',
        description: 'Esegue un singolo ciclo del workflow specificato.',
        options: [
            { flag: '--workflow <name>', description: 'Workflow da eseguire (invite, check, message, warmup, all)', default: 'all' },
            { flag: '--dry-run', description: 'Simula senza inviare' },
            { flag: '--skip-preflight', description: 'Salta il doctor preflight' },
        ],
        examples: [
            'bot run invite',
            'bot run message --dry-run',
            'bot run all --skip-preflight',
        ],
    },
    'dry-run': {
        usage: 'dry-run [invite|check|message|warmup|all]',
        description: 'Simula un ciclo del workflow senza azioni reali.',
        options: [
            { flag: '--workflow <name>', description: 'Workflow da simulare', default: 'all' },
        ],
        examples: ['bot dry-run invite', 'bot dry-run all'],
    },
    'run-loop': {
        usage: 'run-loop [workflow] [intervalSec] [--cycles <n>] [--dry-run]',
        description: 'Esegue il workflow in loop continuo con pausa tra i cicli.',
        options: [
            { flag: '--cycles <n>', description: 'Numero massimo di cicli (0 = infinito)', default: '0' },
            { flag: '--dry-run', description: 'Simula senza inviare' },
            { flag: '--skip-preflight', description: 'Salta il doctor preflight' },
        ],
        examples: [
            'bot run-loop all 900',
            'bot run-loop invite 600 --cycles 5',
            'bot run-loop --dry-run',
        ],
    },
    autopilot: {
        usage: 'autopilot [intervalSec] [--cycles <n>] [--dry-run]',
        description: 'Alias per run-loop con workflow "all".',
        options: [
            { flag: '--cycles <n>', description: 'Numero massimo di cicli', default: '0' },
            { flag: '--dry-run', description: 'Simula senza inviare' },
        ],
        examples: ['bot autopilot', 'bot autopilot 600 --cycles 10'],
    },
    import: {
        usage: 'import --file <path.csv> [--list <nome_lista>]',
        description: 'Importa lead da un file CSV.',
        options: [
            { flag: '--file <path>', description: 'Percorso del file CSV (obbligatorio)' },
            { flag: '--list <name>', description: 'Nome della lista di destinazione', default: 'default' },
        ],
        examples: ['bot import --file leads.csv --list "Tech Companies"'],
    },
    login: {
        usage: 'login [timeoutSec] [--account <id>]',
        description: 'Apre il browser per login manuale su LinkedIn.',
        options: [
            { flag: '--timeout <sec>', description: 'Timeout per il login', default: '300' },
            { flag: '--account <id>', description: 'ID account da utilizzare' },
        ],
        examples: ['bot login', 'bot login 600 --account main'],
    },
    salesnav: {
        usage: 'salesnav <save|sync|resolve|lists|create|add> [opzioni]',
        description: 'Comandi Sales Navigator unificati.',
        options: [
            { flag: 'save', description: 'Bulk save da ricerche salvate (default)' },
            { flag: 'sync', description: 'Sincronizza una lista SalesNav' },
            { flag: 'resolve', description: 'Risolvi URL SalesNav → profilo standard' },
            { flag: 'lists', description: 'Mostra elenchi SalesNav nel DB' },
            { flag: 'create', description: 'Crea una nuova lista SalesNav' },
            { flag: 'add', description: 'Aggiungi un lead a una lista' },
            { flag: '--list <name>', description: 'Nome lista target' },
            { flag: '--account <id>', description: 'ID account' },
            { flag: '--no-proxy', description: 'Disabilita proxy' },
            { flag: '--dry-run', description: 'Simula senza modifiche' },
        ],
        examples: [
            'bot salesnav save --list "IT Decision Makers" --max-pages 5',
            'bot salesnav sync --list "Tech" --url https://...',
            'bot salesnav resolve --fix --limit 50',
            'bot salesnav lists',
        ],
    },
    'test-connection': {
        usage: 'test-connection [--account <id>] [--no-proxy]',
        description: 'Verifica proxy, browser e login LinkedIn. Report JSON.',
        options: [
            { flag: '--account <id>', description: 'ID account da testare' },
            { flag: '--no-proxy', description: 'Testa senza proxy' },
        ],
        examples: ['bot test-connection', 'bot test-connection --account main --no-proxy'],
    },
    doctor: {
        usage: 'doctor',
        description: 'Diagnostica completa: DB, sessione, proxy, compliance, selettori.',
        options: [],
        examples: ['bot doctor'],
    },
    status: {
        usage: 'status',
        description: 'Mostra stato corrente: pausa, quarantena, stats giornaliere.',
        options: [],
        examples: ['bot status'],
    },
    diagnostics: {
        usage: 'diagnostics [--sections <all|health,locks,queue,sync,selectors>] [--date <YYYY-MM-DD>]',
        description: 'Report diagnostico dettagliato per sezione.',
        options: [
            { flag: '--sections <list>', description: 'Sezioni da includere (separare con virgola)', default: 'all' },
            { flag: '--date <YYYY-MM-DD>', description: 'Data di riferimento', default: 'oggi' },
        ],
        examples: ['bot diagnostics', 'bot diag --sections health,queue'],
    },
    'config-validate': {
        usage: 'config-validate',
        description: 'Valida la configurazione completa e restituisce un report JSON con errori, warning, stato proxy e JA3.',
        options: [],
        examples: ['bot config-validate', 'bot config-validate | jq .summary'],
    },
    pause: {
        usage: 'pause [minutes|indefinite] [reason]',
        description: 'Mette in pausa l\'automazione per N minuti.',
        options: [
            { flag: 'minutes', description: 'Durata della pausa (o "indefinite")' },
            { flag: 'reason', description: 'Motivo della pausa' },
        ],
        examples: ['bot pause 60 "manutenzione"', 'bot pause indefinite'],
    },
    resume: {
        usage: 'resume',
        description: 'Riprende l\'automazione dalla pausa.',
        options: [],
        examples: ['bot resume'],
    },
    dashboard: {
        usage: 'dashboard',
        description: 'Avvia il server web della dashboard su porta 3000.',
        options: [],
        examples: ['bot dashboard'],
    },
    'enrich-targets': {
        usage: 'enrich-targets [limit] [--dry-run]',
        description: 'Arricchisce lead con dati da fonti esterne.',
        options: [
            { flag: '--limit <n>', description: 'Numero massimo di lead', default: '10' },
            { flag: '--dry-run', description: 'Simula senza modifiche' },
        ],
        examples: ['bot enrich-targets 50', 'bot enrich-targets --dry-run'],
    },
    'enrich-deep': {
        usage: 'enrich-deep --lead <id> | --list <nome> [--limit N] [--dry-run]',
        description: 'Arricchimento approfondito per lead o lista.',
        options: [
            { flag: '--lead <id>', description: 'ID lead specifico' },
            { flag: '--list <name>', description: 'Nome lista' },
            { flag: '--limit <n>', description: 'Limite lead da lista', default: '10' },
            { flag: '--dry-run', description: 'Simula senza modifiche' },
        ],
        examples: ['bot enrich-deep --lead 42', 'bot enrich-deep --list "Tech" --limit 20'],
    },
    'random-activity': {
        usage: 'random-activity [--account <id>] [--max-actions <n>] [--dry-run]',
        description: 'Esegue attività random su LinkedIn (feed scroll, notifiche, ricerche).',
        options: [
            { flag: '--account <id>', description: 'ID account' },
            { flag: '--max-actions <n>', description: 'Numero massimo di azioni', default: '5' },
            { flag: '--dry-run', description: 'Simula senza agire' },
        ],
        examples: ['bot random-activity --max-actions 3'],
    },
    'db-analyze': {
        usage: 'db-analyze',
        description: 'Analizza il database: tabelle, conteggi, indici, dimensione, integrità.',
        options: [],
        examples: ['bot db-analyze'],
    },
    'daily-report': {
        usage: 'daily-report',
        description: 'Genera e invia il report giornaliero (Telegram + log). Utile per trigger manuale.',
        options: [],
        examples: ['bot daily-report'],
    },
    repl: {
        usage: 'repl',
        description: 'Avvia una REPL interattiva per eseguire comandi e query sul database.',
        options: [],
        examples: ['bot repl'],
    },
    warmup: {
        usage: 'warmup [--account <id>]',
        description: 'Esegue un singolo ciclo di warmup sessione (feed, notifiche, ricerca).',
        options: [
            { flag: '--account <id>', description: 'ID account da scaldare' },
        ],
        examples: ['bot warmup', 'bot warmup --account main'],
    },
};

/**
 * Stampa l'help specifico per un comando.
 * @returns true se l'help è stato trovato e stampato, false altrimenti.
 */
export function printCommandHelp(command: string): boolean {
    const help = COMMAND_HELP[command];
    if (!help) {
        return false;
    }

    console.log(`\n  ${help.usage}\n`);
    console.log(`  ${help.description}\n`);

    if (help.options.length > 0) {
        console.log('  Opzioni:');
        for (const opt of help.options) {
            const def = opt.default ? ` (default: ${opt.default})` : '';
            console.log(`    ${opt.flag.padEnd(28)} ${opt.description}${def}`);
        }
        console.log('');
    }

    if (help.examples.length > 0) {
        console.log('  Esempi:');
        for (const ex of help.examples) {
            console.log(`    ${ex}`);
        }
        console.log('');
    }

    return true;
}
