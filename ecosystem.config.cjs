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
        kill_timeout: 10000,
        exp_backoff_restart_delay: 1000,  // Backoff esponenziale: 1s, 2s, 4s, ...
        max_restarts: 50,                 // Più tentativi prima di arrendersi
        min_uptime: "30s",
        out_file: "./logs/daemon-out.log",
        error_file: "./logs/daemon-error.log",
        merge_logs: true,
        log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        log_type: "json",
        max_size: "50M",
        env: {
            NODE_ENV: "development",
            FORCE_COLOR: "1"
        },
        env_production: {
            NODE_ENV: "production",
            FORCE_COLOR: "0"
        }
    }]
};
