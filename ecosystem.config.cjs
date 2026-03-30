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
            kill_timeout: 10000,
            exp_backoff_restart_delay: 1000,
            max_restarts: 50,
            min_uptime: "30s",
            out_file: "./logs/daemon-out.log",
            error_file: "./logs/daemon-error.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            log_type: "json",
            max_size: "50M",
            env: { NODE_ENV: "development", FORCE_COLOR: "1" },
            env_production: { NODE_ENV: "production", FORCE_COLOR: "0" }
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
            kill_timeout: 5000,
            exp_backoff_restart_delay: 2000,
            max_restarts: 20,
            min_uptime: "10s",
            out_file: "./logs/api-out.log",
            error_file: "./logs/api-error.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            env: { NODE_ENV: "development", FORCE_COLOR: "1" },
            env_production: { NODE_ENV: "production", FORCE_COLOR: "0" }
        },

        // ── n8n — workflow automation ─────────────────────────────────────
        // Avvia n8n sulla porta 5678. Eseguire "pm2 save" dopo il primo start
        // e poi "pm2 startup" per avviarlo automaticamente al boot di Windows.
        {
            name: "n8n",
            script: "npx",
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
                N8N_LOG_LEVEL: "warn"
            }
        }
    ]
};
