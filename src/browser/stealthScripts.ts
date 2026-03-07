/**
 * browser/stealthScripts.ts
 * ─────────────────────────────────────────────────────────────────
 * Script JavaScript iniettato via addInitScript in ogni pagina
 * per mascherare le impronte di automazione Playwright.
 *
 * Copre:
 *  1. WebRTC leak prevention (RTCPeerConnection kill)
 *  2. navigator.webdriver force-delete
 *  3. navigator.plugins normalization (PluginArray-compliant)
 *  4. navigator.languages normalization
 *  5. window.chrome mock (runtime, loadTimes, csi)
 *  6. navigator.permissions.query override
 *  7. Anti-headless guards (condizionali)
 *  8. navigator.hardwareConcurrency normalization
 *  9. Battery API mock (navigator.getBattery)
 * 10. Notification.permission mock
 * 11. AudioContext Fingerprint Spoofing
 */

export interface StealthScriptOptions {
    locale: string;
    languages: string[];
    isHeadless: boolean;
    viewportWidth: number;
    viewportHeight: number;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    colorDepth?: number;
    audioNoise?: number;
}

const DEFAULT_OPTIONS: StealthScriptOptions = {
    locale: 'it-IT',
    languages: ['it-IT', 'it', 'en-US', 'en'],
    isHeadless: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    colorDepth: 24,
    audioNoise: 0.000001,
};

/**
 * Genera lo script stealth completo da iniettare nel browser.
 * Lo script è una IIFE che si auto-esegue prima di qualsiasi
 * codice della pagina, garantendo che le proprietà siano
 * mascherate fin dal primo accesso.
 */
export function buildStealthInitScript(options?: Partial<StealthScriptOptions>): string {
    const opts: StealthScriptOptions = { ...DEFAULT_OPTIONS, ...options };
    const languagesJson = JSON.stringify(opts.languages);
    const hwConcurrency = opts.hardwareConcurrency ?? 8;
    const deviceMemory = opts.deviceMemory ?? 8;
    const colorDepth = opts.colorDepth ?? 24;
    const audioNoise = opts.audioNoise ?? 0.000001;

    return `(() => {
    // ─── 1. WebRTC Leak Prevention ───────────────────────────────────────────
    // Impedisce che RTCPeerConnection riveli l'IP reale bypassando il proxy.
    // Il flag Chrome --disable-webrtc copre il rendering, ma non il JS diretto.
    const rtcKeys = [
        'RTCPeerConnection',
        'webkitRTCPeerConnection',
        'mozRTCPeerConnection',
        'RTCDataChannel',
        'RTCSessionDescription',
        'RTCIceCandidate'
    ];
    for (const key of rtcKeys) {
        if (key in window) {
            try {
                Object.defineProperty(window, key, {
                    get: () => undefined,
                    configurable: false
                });
            } catch {
                try { window[key] = undefined; } catch {}
            }
        }
    }

    // ─── 2. navigator.webdriver force-delete ─────────────────────────────────
    // Doppia protezione: il flag --disable-blink-features=AutomationControlled
    // copre il Chrome flag, ma alcuni test JS lo checkano direttamente.
    try {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true
        });
    } catch {}
    // Delete anche dal prototype
    try {
        const proto = Object.getPrototypeOf(navigator);
        if (proto && 'webdriver' in proto) {
            Object.defineProperty(proto, 'webdriver', {
                get: () => false,
                configurable: true
            });
        }
    } catch {}

    // ─── 3. navigator.plugins normalization (PluginArray-compliant) ──────────
    // Playwright/headless ha plugins vuoti. Chrome reale ne ha almeno 3.
    // CRITICO: ritornare un oggetto che superi instanceof PluginArray check.
    try {
        const fakePluginData = [
            {
                name: 'Chrome PDF Plugin',
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                mimeTypes: [{ type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
            },
            {
                name: 'Chrome PDF Viewer',
                description: '',
                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: '' }]
            },
            {
                name: 'Native Client',
                description: '',
                filename: 'internal-nacl-plugin',
                mimeTypes: [
                    { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
                    { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }
                ]
            }
        ];

        // Costruisce oggetti Plugin-like con prototype corretto
        const makePlugin = (data) => {
            const plugin = {};
            Object.defineProperties(plugin, {
                name: { value: data.name, enumerable: true },
                description: { value: data.description, enumerable: true },
                filename: { value: data.filename, enumerable: true },
                length: { value: data.mimeTypes.length, enumerable: true }
            });
            data.mimeTypes.forEach((m, i) => {
                Object.defineProperty(plugin, i, {
                    value: { type: m.type, suffixes: m.suffixes, description: m.description, enabledPlugin: plugin },
                    enumerable: true
                });
            });
            plugin.item = (i) => plugin[i] || null;
            plugin.namedItem = (name) => data.mimeTypes.find(m => m.type === name) ? plugin[data.mimeTypes.findIndex(m => m.type === name)] : null;
            // Maschera il prototype per apparire come Plugin nativo
            try { Object.setPrototypeOf(plugin, Plugin.prototype); } catch {}
            return plugin;
        };

        const plugins = fakePluginData.map(makePlugin);

        // Costruisce PluginArray-like con prototype corretto
        const pluginArray = {};
        plugins.forEach((p, i) => {
            Object.defineProperty(pluginArray, i, { value: p, enumerable: true });
        });
        Object.defineProperties(pluginArray, {
            length: { value: plugins.length, enumerable: true },
            item: { value: (i) => plugins[i] || null },
            namedItem: { value: (name) => plugins.find(p => p.name === name) || null },
            refresh: { value: () => {} }
        });
        // Symbol.iterator per supportare for...of
        pluginArray[Symbol.iterator] = function*() {
            for (let i = 0; i < plugins.length; i++) yield plugins[i];
        };
        // Maschera il prototype per superare instanceof PluginArray check
        try { Object.setPrototypeOf(pluginArray, PluginArray.prototype); } catch {}

        Object.defineProperty(navigator, 'plugins', {
            get: () => pluginArray,
            configurable: true
        });

        // mimeTypes analogamente con prototype MimeTypeArray
        const allMimes = [];
        fakePluginData.forEach((p, pi) => {
            p.mimeTypes.forEach(m => {
                allMimes.push({ type: m.type, suffixes: m.suffixes, description: m.description, enabledPlugin: plugins[pi] });
            });
        });
        const mimeArray = {};
        allMimes.forEach((m, i) => {
            Object.defineProperty(mimeArray, i, { value: m, enumerable: true });
        });
        Object.defineProperties(mimeArray, {
            length: { value: allMimes.length, enumerable: true },
            item: { value: (i) => allMimes[i] || null },
            namedItem: { value: (name) => allMimes.find(m => m.type === name) || null }
        });
        mimeArray[Symbol.iterator] = function*() {
            for (let i = 0; i < allMimes.length; i++) yield allMimes[i];
        };
        try { Object.setPrototypeOf(mimeArray, MimeTypeArray.prototype); } catch {}
        Object.defineProperty(navigator, 'mimeTypes', {
            get: () => mimeArray,
            configurable: true
        });
    } catch {}

    // ─── 4. navigator.languages normalization ────────────────────────────────
    // Playwright setta solo il locale singolo. Chrome reale ha una lista.
    try {
        Object.defineProperty(navigator, 'languages', {
            get: () => ${languagesJson},
            configurable: true
        });
    } catch {}

    // ─── 5. window.chrome mock ───────────────────────────────────────────────
    // In un Chrome reale, window.chrome esiste con runtime, loadTimes, csi.
    // Playwright non lo crea, e questo è un red flag per i bot detector.
    if (!window.chrome) {
        window.chrome = {};
    }
    if (!window.chrome.runtime) {
        window.chrome.runtime = {
            // id è undefined in Chrome senza estensioni attive — alcuni detector controllano typeof
            id: undefined,
            OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
            OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
            PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
            RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
            connect: function() { return { onMessage: { addListener: function(){} }, postMessage: function(){}, disconnect: function(){} }; },
            sendMessage: function() {},
        };
    }
    if (!window.chrome.loadTimes) {
        window.chrome.loadTimes = function() {
            return {
                commitLoadTime: Date.now() / 1000,
                connectionInfo: 'h2',
                finishDocumentLoadTime: Date.now() / 1000 + 0.1,
                finishLoadTime: Date.now() / 1000 + 0.2,
                firstPaintAfterLoadTime: 0,
                firstPaintTime: Date.now() / 1000 + 0.05,
                navigationType: 'Other',
                npnNegotiatedProtocol: 'h2',
                requestTime: Date.now() / 1000 - 0.3,
                startLoadTime: Date.now() / 1000 - 0.2,
                wasAlternateProtocolAvailable: false,
                wasFetchedViaSpdy: true,
                wasNpnNegotiated: true,
            };
        };
    }
    if (!window.chrome.csi) {
        window.chrome.csi = function() {
            return {
                onloadT: Date.now(),
                pageT: Math.random() * 1000 + 500,
                startE: Date.now() - Math.floor(Math.random() * 500),
                tran: 15
            };
        };
    }

    // ─── 6. navigator.permissions.query override ─────────────────────────────
    // Playwright risponde "denied" a permissions.query({name:'notifications'}).
    // Chrome reale risponde "prompt" (l'utente non ha mai risposto).
    const originalPermissionsQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (originalPermissionsQuery) {
        navigator.permissions.query = function(descriptor) {
            if (descriptor && descriptor.name === 'notifications') {
                return Promise.resolve({ state: 'prompt', onchange: null, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true; } });
            }
            return originalPermissionsQuery(descriptor);
        };
    }

    // ─── 7. Anti-headless guards (condizionali) ──────────────────────────────
    ${opts.isHeadless
            ? `
    // In headless mode: normalizza le dimensioni della finestra per sembrare reale
    try {
        Object.defineProperty(window, 'outerWidth', { get: () => ${opts.viewportWidth}, configurable: true });
        Object.defineProperty(window, 'outerHeight', { get: () => ${opts.viewportHeight + 85}, configurable: true }); // +85 per toolbar Chrome
        Object.defineProperty(window, 'innerWidth', { get: () => ${opts.viewportWidth}, configurable: true });
        Object.defineProperty(window, 'innerHeight', { get: () => ${opts.viewportHeight}, configurable: true });
    } catch {}

    // Mock navigator.connection (assente in headless)
    if (!navigator.connection) {
        try {
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    effectiveType: '4g',
                    rtt: 50,
                    downlink: 10,
                    saveData: false,
                    onchange: null,
                    addEventListener: function(){},
                    removeEventListener: function(){},
                    dispatchEvent: function(){ return true; }
                }),
                configurable: true
            });
        } catch {}
    }
    `
            : '// Headless disabled — no extra guards needed.'
        }

    // ─── 8. navigator.hardwareConcurrency normalization ──────────────────────
    // Headless/Playwright può avere valori anomali (1 o 2).
    // Chrome reale su desktop moderno: 4-16.
    try {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => ${hwConcurrency},
            configurable: true
        });
    } catch {}

    // ─── 9. Battery API mock ─────────────────────────────────────────────────
    // navigator.getBattery() assente in headless è un segnale di automazione.
    // Effettuiamo un mock dinamico basato sul tempo per simulare scarica progressiva (es. laptop/mobile).
    try {
        if (!navigator.getBattery || navigator.getBattery.toString().includes('native code')) {
            const mockStartTime = Date.now();
            const startLevel = 0.85 + (Math.floor(Date.now() % 10) / 100);
            
            navigator.getBattery = function() {
                // drain fittizio dell'1% ogni 10 minuti
                const elapsedMinutes = (Date.now() - mockStartTime) / 60000;
                const drain = (elapsedMinutes / 10) * 0.01;
                const currentLevel = Math.max(0.05, startLevel - drain);
                const charging = elapsedMinutes < 2 ? true : false; // simula "appena staccato dal caricatore" per i primi minuti

                const batteryMock = {
                    charging: charging,
                    chargingTime: charging ? (1 - currentLevel) * 7200 : Infinity,
                    dischargingTime: charging ? Infinity : (currentLevel / 0.1) * 600, // stima restanti proporzionale al livello 
                    level: currentLevel,
                    onchargingchange: null,
                    onchargingtimechange: null,
                    ondischargingtimechange: null,
                    onlevelchange: null,
                    addEventListener: function(){},
                    removeEventListener: function(){},
                    dispatchEvent: function(){ return true; }
                };
                return Promise.resolve(batteryMock);
            };
        }
    } catch {}

    // ─── 10. Notification.permission mock ─────────────────────────────────────
    // Notification.permission uses 'default'/'granted'/'denied' (NOT 'prompt').
    // permissions.query({name:'notifications'}) uses 'prompt'/'granted'/'denied'.
    // Both APIs represent the same "never asked" state with different values.
    try {
        if (typeof Notification !== 'undefined') {
            Object.defineProperty(Notification, 'permission', {
                get: () => 'default',
                configurable: true
            });
        }
    } catch {}

    // ─── 11. AudioContext Fingerprint Spoofing ──────────────────────────────
    // getChannelData() e getFloatFrequencyData() sono usati per generare l'audio fingerprint.
    // Iniettiamo un rumore deterministico per mascherare l'impronta reale.
    try {
        const audioContexts = window.AudioContext || window.webkitAudioContext;
        if (audioContexts) {
            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
            const baseNoise = ${audioNoise};
            AudioBuffer.prototype.getChannelData = function(channel) {
                const results = originalGetChannelData.apply(this, arguments);
                for (let i = 0; i < results.length; i += 7) {
                    results[i] += baseNoise * (0.5 + Math.sin(i * 0.017) * 0.5);
                }
                return results;
            };
            
            if (typeof AnalyserNode !== 'undefined' && AnalyserNode.prototype.getFloatFrequencyData) {
                const originalGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
                AnalyserNode.prototype.getFloatFrequencyData = function(array) {
                    originalGetFloatFrequencyData.apply(this, arguments);
                    for (let i = 0; i < array.length; i += 5) {
                        array[i] += baseNoise * (0.3 + Math.cos(i * 0.023) * 0.7);
                    }
                };
            }
        }
    } catch {}

    // ─── 12. navigator.deviceMemory mock ─────────────────────────────────────
    // Headless browser spesso espongono deviceMemory bassi (es. docker).
    try {
        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => ${deviceMemory},
            configurable: true
        });
    } catch {}

    // ─── 13. screen.colorDepth e screen.pixelDepth mock ──────────────────────
    try {
        if (window.screen) {
            Object.defineProperty(window.screen, 'colorDepth', {
                get: () => ${colorDepth},
                configurable: true
            });
            Object.defineProperty(window.screen, 'pixelDepth', {
                get: () => ${colorDepth},
                configurable: true
            });
        }
    } catch {}
    // ─── 14. Fake Storage Seeder (IndexedDB / LocalStorage) ──────────────────
    // Container puliti destano sospetto. Iniettiamo finte tracce storiche.
    try {
        // 1. LocalStorage Seed
        if (typeof window.localStorage !== 'undefined') {
            try {
                if (!window.localStorage.getItem('_ga')) {
                    const randomGATail = Math.floor(Math.random() * 1000000000) + '.' + (Math.floor(Date.now() / 1000) - 86400 * 5);
                    window.localStorage.setItem('_ga', 'GA1.2.' + randomGATail);
                }
                if (!window.localStorage.getItem('_fbp')) {
                    const fbTail = Math.floor(Math.random() * 10000000000);
                    window.localStorage.setItem('_fbp', 'fb.1.' + Date.now() + '.' + fbTail);
                }
                // li_sp rimossa: chiave proprietaria LinkedIn, iniettarla è più rischioso di non averla
            } catch {}
        }

        // 2. IndexedDB Monkey Patch
        // Simula la presenza di vecchi database (es. localforage / firebase)
        if (typeof window.indexedDB !== 'undefined' && typeof window.indexedDB.databases === 'function') {
            const originalDatabases = window.indexedDB.databases;
            window.indexedDB.databases = function() {
                return originalDatabases.apply(this, arguments).then((dbs) => {
                    const mockDBs = [
                        { name: 'localforage', version: 2 },
                        { name: 'firebaseLocalStorageDb', version: 1 }
                    ];
                    
                    if (!dbs || dbs.length === 0) {
                        return mockDBs;
                    }
                    
                    const merged = [...dbs];
                    for (const m of mockDBs) {
                        if (!merged.find(x => x.name === m.name)) {
                            merged.push(m);
                        }
                    }
                    return merged;
                });
            };
        }
    } catch {}
})();`;
}
