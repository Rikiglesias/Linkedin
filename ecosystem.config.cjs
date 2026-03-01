module.exports = {
    apps: [{
        name: "linkedin-bot-daemon",
        script: "dist/index.js",
        args: "run-loop",
        instances: 1,
        exec_mode: "fork",
        watch: false,
        autorestart: true,
        max_memory_restart: "1G",
        restart_delay: 5000,          // Attende 5s prima di riavviare
        max_restarts: 10,             // Max 10 riavvii in 15 minuti
        min_uptime: "30s",            // Deve stare su almeno 30s per essere "stable"
        out_file: "./logs/daemon-out.log",
        error_file: "./logs/daemon-error.log",
        merge_logs: true,
        log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        log_type: "json",
        env: {
            NODE_ENV: "production",
            FORCE_COLOR: "1"
        }
    }]
};
