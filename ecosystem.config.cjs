module.exports = {
    apps: [{
        name: "linkedin-bot-daemon",
        script: "src/index.ts",
        interpreter: "node",
        interpreter_args: "--loader ts-node/esm", // o semplicemente node_modules/.bin/ts-node
        // alternativamente possiamo usare ts-node direttamente nel comando di avvio
        args: "daemon",
        instances: 1,
        exec_mode: "fork",
        watch: false,
        autorestart: true,
        max_memory_restart: "1G",
        out_file: "./logs/daemon-out.log",
        error_file: "./logs/daemon-error.log",
        merge_logs: true,
        log_date_format: "YYYY-MM-DD HH:mm Z",
        env: {
            NODE_ENV: "production",
            FORCE_COLOR: "1"
        }
    }]
};
