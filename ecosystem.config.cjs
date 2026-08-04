const path = require('node:path');
const fs = require('node:fs');

/**
 * Percorso di `npx-cli.js`, cioè npx come FILE JAVASCRIPT.
 *
 * PM2 avvia ogni app passandola a node. Su Windows `npx` è `npx.cmd`, un file batch: node
 * prova a interpretarlo come JavaScript e muore sulla prima riga di commento
 * (`SyntaxError: Unexpected token ':'`). È quello che è successo qui dal 2026-03-29 in poi —
 * `logs/n8n-error.log` è cresciuto fino a 1,8 MB con sempre lo stesso errore, e n8n non è mai
 * partito. `interpreter: 'none'` non risolve: fa fallire lo spawn con EFTYPE.
 * La via che funziona, documentata sugli issue PM2, è puntare al CLI JavaScript.
 *
 * Ritorna null se non lo trova: in quel caso la app n8n NON viene registrata affatto, invece
 * di registrarne una che andrebbe solo in crash-loop.
 */
function resolveNpxCli() {
    const nodeDir = path.dirname(process.execPath);
    const candidates = [
        // Windows: node.exe e node_modules/npm stanno nella stessa cartella.
        path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        // Linux/macOS: /usr/bin/node -> /usr/lib/node_modules/npm/...
        path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const npxCli = resolveNpxCli();

const cleanInheritedProxyEnv = {
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    GIT_HTTP_PROXY: "",
    GIT_HTTPS_PROXY: "",
    NO_PROXY: "localhost,127.0.0.1,::1",
};

module.exports = {
    apps: [
        // ── LinkedIn Bot — automazione (run-loop) ──────────────────────────
        {
            name: "linkedin-bot-daemon",
            script: "dist/index.js",
            args: "run-loop",
            instances: 1,
            exec_mode: "fork",
            watch: false,
            autorestart: true,
            max_memory_restart: "1G",
            kill_timeout: 35000,
            exp_backoff_restart_delay: 1000,
            max_restarts: 50,
            min_uptime: "30s",
            out_file: "./logs/daemon-out.log",
            error_file: "./logs/daemon-error.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            log_type: "json",
            max_size: "50M",
            env: {
                NODE_ENV: "development",
                FORCE_COLOR: "1",
                ...cleanInheritedProxyEnv,
            },
            env_production: {
                NODE_ENV: "production",
                FORCE_COLOR: "0",
                ...cleanInheritedProxyEnv,
            }
        },

        // ── LinkedIn Bot — server HTTP/dashboard (porta 3000) ─────────────
        // Espone /api/health, /api/v1/automation/snapshot, /api/controls/*
        // Usato da n8n per leggere metriche e inviare comandi.
        {
            name: "linkedin-bot-api",
            script: "dist/index.js",
            args: "dashboard",
            instances: 1,
            exec_mode: "fork",
            watch: false,
            autorestart: true,
            max_memory_restart: "512M",
            kill_timeout: 15000,
            exp_backoff_restart_delay: 2000,
            max_restarts: 20,
            min_uptime: "10s",
            out_file: "./logs/api-out.log",
            error_file: "./logs/api-error.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            env: {
                NODE_ENV: "development",
                FORCE_COLOR: "1",
                ...cleanInheritedProxyEnv,
            },
            env_production: {
                NODE_ENV: "production",
                FORCE_COLOR: "0",
                ...cleanInheritedProxyEnv,
            }
        },

        // ── n8n — workflow automation ─────────────────────────────────────
        // Avvia n8n sulla porta 5678. Eseguire "pm2 save" dopo il primo start
        // e poi "pm2 startup" per avviarlo automaticamente al boot di Windows.
        //
        // Alternativa già pronta: il servizio `n8n` di docker-compose.yml (immagine
        // n8nio/n8n:latest, stessa porta 5678, volume n8n_data). Sono due modi di avviare
        // LO STESSO servizio: usarne uno solo per volta, o litigano sulla porta.
        //
        // Se npx-cli.js non si trova, questa voce sparisce dalla lista invece di finire in
        // crash-loop (vedi resolveNpxCli sopra): meglio nessun processo che un processo che
        // riparte all'infinito riempiendo i log.
        ...(npxCli ? [{
            name: "n8n",
            script: npxCli,
            args: "-y n8n start",
            instances: 1,
            exec_mode: "fork",
            watch: false,
            autorestart: true,
            max_memory_restart: "1G",
            kill_timeout: 10000,
            exp_backoff_restart_delay: 3000,
            max_restarts: 10,
            min_uptime: "30s",
            out_file: "./logs/n8n-out.log",
            error_file: "./logs/n8n-error.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            env: {
                NODE_ENV: "production",
                N8N_PORT: "5678",
                N8N_LOG_LEVEL: "warn",
                ...cleanInheritedProxyEnv,
            }
        }] : [])
    ]
};
