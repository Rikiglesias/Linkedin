const fs = require('fs');
const path = require('path');

function appendMarker(eventName, payload) {
    const markerPath = (process.env.PLUGIN_EXAMPLE_MARKER_FILE || '').trim();
    if (!markerPath) return;

    try {
        const normalized = path.resolve(process.cwd(), markerPath);
        fs.mkdirSync(path.dirname(normalized), { recursive: true });
        fs.appendFileSync(
            normalized,
            `${JSON.stringify({
                event: eventName,
                at: new Date().toISOString(),
                payload,
            })}\n`,
            'utf8'
        );
    } catch {
        // No-op: il plugin non deve mai fermare il runtime.
    }
}

const plugin = {
    name: 'example-engagement-booster',
    version: '1.0.0',

    async onInit() {
        appendMarker('onInit', {});
        console.log('[PLUGIN example-engagement-booster] initialized');
    },

    async onIdle(event) {
        appendMarker('onIdle', {
            cycle: event.cycle,
            workflow: event.workflow,
            localDate: event.localDate,
        });
    },

    async onDailyReport(stats) {
        appendMarker('onDailyReport', {
            date: stats.date,
            invited: stats.invited,
            accepted: stats.accepted,
            acceptRate: stats.acceptRate,
            replyRate: stats.replyRate,
        });
    },

    async onShutdown() {
        appendMarker('onShutdown', {});
    },
};

module.exports = plugin;
module.exports.default = plugin;

