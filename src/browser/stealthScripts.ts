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
 * 15. getHasLiedOs bypass (OS consistency: userAgent vs platform vs oscpu)
 * 16. getHasLiedLanguages bypass (language === languages[0])
 * 17. CDP leak detection bypass (Runtime.enable / Debugger artifacts)
 * 18. WebGL renderer consistency (GPU matches claimed OS)
 * 19. iframe contentWindow.chrome consistency
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
    /** User-Agent string per determinare il browser family (Chrome vs Firefox).
     * Se contiene 'Firefox', le sezioni Chrome-specific (plugins, window.chrome) vengono saltate. */
    userAgent?: string;
    /** Sezioni da saltare se CloakBrowser gestisce già queste API a livello binario.
     * Valori: 'canvas', 'webgl', 'hwconcurrency', 'plugins', 'audio', 'battery', 'webrtc' */
    skipSections?: Set<string>;
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
    const skip = opts.skipSections ?? new Set<string>();
    // Serialize skip set so the browser IIFE can check at runtime
    const skipJson = JSON.stringify([...skip]);

    const isFirefoxBrowser = /Firefox\//i.test(opts.userAgent ?? '');

    return `(() => {
    const _skip = new Set(${skipJson});
    const _isFirefox = ${isFirefoxBrowser};
    // ─── 1. WebRTC Leak Prevention ───────────────────────────────────────────
    // Impedisce che RTCPeerConnection riveli l'IP reale bypassando il proxy.
    // Il flag Chrome --disable-webrtc copre il rendering, ma non il JS diretto.
    if (!_skip.has('webrtc')) {
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
    } // end webrtc skip

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
    // Firefox ha un PluginArray vuoto (length=0) — NON iniettare Chrome plugins.
    if (!_skip.has('plugins') && !_isFirefox) try {
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
    // Firefox NON ha window.chrome — iniettarlo su Firefox è un marker di spoofing.
    if (!_isFirefox && !window.chrome) {
        window.chrome = {};
    }
    if (!_isFirefox && window.chrome && !window.chrome.runtime) {
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
    if (!_isFirefox && window.chrome && !window.chrome.loadTimes) {
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
    if (!_isFirefox && window.chrome && !window.chrome.csi) {
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
    ${
        opts.isHeadless
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
    if (!_skip.has('hwconcurrency')) try {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => ${hwConcurrency},
            configurable: true
        });
    } catch {}

    // ─── 9. Battery API mock ─────────────────────────────────────────────────
    // navigator.getBattery() assente in headless è un segnale di automazione.
    // Effettuiamo un mock dinamico basato sul tempo per simulare scarica progressiva (es. laptop/mobile).
    if (!_skip.has('battery')) try {
        if (!navigator.getBattery || navigator.getBattery.toString().includes('native code')) {
            const mockStartTime = Date.now();
            const startLevel = 0.85 + (Math.floor(Date.now() % 10) / 100);
            
            navigator.getBattery = function() {
                // drain fittizio dell'1% ogni 10 minuti
                const elapsedMinutes = (Date.now() - mockStartTime) / 60000;
                const drain = (elapsedMinutes / 10) * 0.01;
                const currentLevel = Math.max(0.05, startLevel - drain);
                // Ciclo realistico: 60min charging + 30min discharging (ciclo 90min)
                const charging = (elapsedMinutes % 90) < 60;

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
    if (!_skip.has('audio')) try {
        const audioContexts = window.AudioContext || window.webkitAudioContext;
        if (audioContexts) {
            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
            const baseNoise = ${audioNoise};
            // Mulberry32 PRNG per selezione pseudo-casuale dei campioni da modificare.
            // Evita pattern a intervallo fisso (ogni N-esimo campione) che sono
            // trivialmente rilevabili da servizi di fingerprinting.
            let _audioSeed = Math.abs(baseNoise * 1e9 | 0) || 1;
            function audioRng() {
                _audioSeed |= 0; _audioSeed = _audioSeed + 0x6D2B79F5 | 0;
                let t = Math.imul(_audioSeed ^ _audioSeed >>> 15, 1 | _audioSeed);
                t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
            AudioBuffer.prototype.getChannelData = function(channel) {
                const results = originalGetChannelData.apply(this, arguments);
                // Reseed per-call con channel + buffer length per varianza tra chiamate
                _audioSeed = Math.abs((baseNoise * 1e9 | 0) + channel * 7919 + results.length * 104729) || 1;
                for (let i = 0; i < results.length; i++) {
                    if (audioRng() < 0.15) {
                        const sign = audioRng() < 0.5 ? 1 : -1;
                        results[i] += baseNoise * sign * audioRng();
                    }
                }
                return results;
            };
            
            if (typeof AnalyserNode !== 'undefined' && AnalyserNode.prototype.getFloatFrequencyData) {
                const originalGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
                AnalyserNode.prototype.getFloatFrequencyData = function(array) {
                    originalGetFloatFrequencyData.apply(this, arguments);
                    _audioSeed = Math.abs((baseNoise * 1e9 | 0) + array.length * 31337) || 1;
                    for (let i = 0; i < array.length; i++) {
                        if (audioRng() < 0.12) {
                            const sign = audioRng() < 0.5 ? 1 : -1;
                            array[i] += baseNoise * sign * audioRng();
                        }
                    }
                };
            }
            // H21: Patch getByteFrequencyData (Uint8Array version) — same PRNG approach.
            // Without this patch, the inconsistency between Float32 (noisy) and Uint8 (clean)
            // versions is detectable by fingerprinting libraries.
            if (typeof AnalyserNode !== 'undefined' && AnalyserNode.prototype.getByteFrequencyData) {
                const originalGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
                AnalyserNode.prototype.getByteFrequencyData = function(array) {
                    originalGetByteFrequencyData.apply(this, arguments);
                    _audioSeed = Math.abs((baseNoise * 1e9 | 0) + array.length * 13337) || 1;
                    for (let i = 0; i < array.length; i++) {
                        if (audioRng() < 0.12) {
                            // Byte values are 0-255; noise ±2 clamped to [0, 255]
                            const sign = audioRng() < 0.5 ? 1 : -1;
                            const noised = array[i] + sign * (1 + Math.floor(audioRng() * 2));
                            array[i] = Math.max(0, Math.min(255, noised));
                        }
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
    // ─── 12. AB-6: performance.memory mock ─────────────────────────────────────
    // Chromium espone performance.memory (non-standard) — un browser headless
    // fresco ha un heap piccolo e costante. Un browser reale con tab aperte
    // ha un heap che cresce nel tempo. Simuliamo crescita progressiva.
    // M41: In Firefox, performance.memory e' ASSENTE by design (non-standard W3C).
    // Il check !performance.memory e' true in Firefox, quindi il mock viene creato.
    // Se Camoufox/CloakBrowser patcha performance.memory a livello C++,
    // il nostro mock JS viene saltato (il check e' false). Questo e' corretto:
    // il browser engine lo gestisce meglio di noi. Nessuna azione necessaria per Firefox.
    try {
        if (typeof performance !== 'undefined' && !performance.memory) {
            const startHeap = 18_000_000 + Math.floor(Math.random() * 12_000_000);
            const pageStartTime = Date.now();
            let lastGcDropAt = 0;
            let accumulatedSpike = 0;
            Object.defineProperty(performance, 'memory', {
                get: () => {
                    const elapsedMin = (Date.now() - pageStartTime) / 60000;
                    // M31: Crescita NON lineare — un browser reale ha picchi e GC drops.
                    // Prima: crescita costante 800KB/min → pattern rilevabile.
                    const baseGrowth = Math.floor(elapsedMin * 800_000 * (0.8 + Math.random() * 0.4));
                    // 8% probabilità di picco (+2-5MB) — apertura tab, caricamento pagina pesante
                    if (Math.random() < 0.08) {
                        accumulatedSpike += 2_000_000 + Math.floor(Math.random() * 3_000_000);
                    }
                    // 5% probabilità di GC drop (-15-35%) — garbage collector
                    const now = Date.now();
                    if (Math.random() < 0.05 && now - lastGcDropAt > 30_000) {
                        accumulatedSpike = Math.floor(accumulatedSpike * (0.65 + Math.random() * 0.20));
                        lastGcDropAt = now;
                    }
                    const used = startHeap + baseGrowth + accumulatedSpike;
                    return {
                        jsHeapSizeLimit: 2_197_815_296,
                        totalJSHeapSize: used + 4_000_000 + Math.floor(Math.random() * 2_000_000),
                        usedJSHeapSize: used,
                    };
                },
                configurable: true,
            });
        }
    } catch {}

    // ─── 14. Font Enumeration Defense (NEW-5) ──────────────────────────────────
    // FingerprintJS 4.x usa document.fonts.check() per enumerare font installati.
    // Headless browser riportano disponibilità font diversa dai browser reali.
    // Mock: restituisce true per font di sistema comuni, false per font esotici.
    try {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.check) {
            const commonFonts = new Set([
                'Arial', 'Verdana', 'Helvetica', 'Times New Roman', 'Georgia',
                'Courier New', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
                'Segoe UI', 'Tahoma', 'Lucida Sans', 'Palatino Linotype',
                'Lucida Console', 'Microsoft Sans Serif', 'Calibri', 'Cambria',
                'Consolas', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
                'system-ui', '-apple-system', 'BlinkMacSystemFont',
            ]);
            const originalCheck = document.fonts.check.bind(document.fonts);
            document.fonts.check = function(font, text) {
                try {
                    const fontFamily = font.replace(/^[\d.]+(?:px|pt|em|rem|%)\s+/i, '').replace(/["']/g, '').trim();
                    if (commonFonts.has(fontFamily)) return true;
                    return originalCheck(font, text);
                } catch {
                    return originalCheck(font, text);
                }
            };
        }
    } catch {}

    // H22: Canvas-based font enumeration defense — measureText noise.
    // FingerprintJS and similar libraries measure glyph dimensions via canvas to enumerate fonts.
    // Adds ±0.5px deterministic noise to TextMetrics.width using Mulberry32 PRNG seeded
    // with the font string. Consistent with the existing canvas fingerprint noise approach.
    try {
        if (typeof CanvasRenderingContext2D !== 'undefined') {
            const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
            CanvasRenderingContext2D.prototype.measureText = function(text) {
                const metrics = originalMeasureText.call(this, text);
                try {
                    // Seed PRNG with canvas font string for determinism across calls
                    const fontStr = this.font || '';
                    let seed = 0;
                    for (let c = 0; c < fontStr.length; c++) {
                        seed = (seed * 31 + fontStr.charCodeAt(c)) | 0;
                    }
                    seed = Math.abs(seed) || 1;
                    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
                    let t2 = Math.imul(seed ^ seed >>> 15, 1 | seed);
                    t2 = t2 + Math.imul(t2 ^ t2 >>> 7, 61 | t2) ^ t2;
                    const noise = (((t2 ^ t2 >>> 14) >>> 0) / 4294967296) * 1.0 - 0.5; // ±0.5px
                    const noisedWidth = metrics.width + noise;
                    Object.defineProperty(metrics, 'width', { value: noisedWidth, configurable: true, enumerable: true });
                } catch {}
                return metrics;
            };
        }
    } catch {}

    // ─── 15. getHasLiedOs bypass ──────────────────────────────────────────────
    // LinkedIn (via FingerprintJS) chiama getHasLiedOs: controlla che userAgent,
    // navigator.platform e navigator.oscpu siano coerenti con lo stesso OS.
    // Se uno dice "Windows" e l'altro dice "Mac", il fingerprint è "forged".
    try {
        const ua = navigator.userAgent || '';
        let expectedPlatform, expectedOscpu;
        if (/iPhone/.test(ua)) {
            expectedPlatform = 'iPhone';
            expectedOscpu = undefined;
        } else if (/Android/.test(ua)) {
            expectedPlatform = 'Linux armv81';
            expectedOscpu = 'Linux armv81';
        } else if (/Windows/.test(ua)) {
            expectedPlatform = 'Win32';
            expectedOscpu = 'Windows NT 10.0; Win64; x64';
        } else if (/Macintosh|Mac OS X/.test(ua)) {
            expectedPlatform = 'MacIntel';
            expectedOscpu = 'Intel Mac OS X 10_15_7';
        } else if (/Linux/.test(ua)) {
            expectedPlatform = 'Linux x86_64';
            expectedOscpu = 'Linux x86_64';
        }
        if (expectedPlatform) {
            Object.defineProperty(navigator, 'platform', {
                get: () => expectedPlatform,
                configurable: true
            });
        }
        if (expectedOscpu) {
            Object.defineProperty(navigator, 'oscpu', {
                get: () => expectedOscpu,
                configurable: true
            });
        }
    } catch {}

    // ─── 16. getHasLiedLanguages bypass ───────────────────────────────────────
    // LinkedIn verifica che navigator.language === navigator.languages[0].
    // Se non corrispondono, è un segnale di spoofing.
    try {
        const langs = ${languagesJson};
        if (langs && langs.length > 0) {
            Object.defineProperty(navigator, 'language', {
                get: () => langs[0],
                configurable: true
            });
        }
    } catch {}

    // ─── 17. CDP leak detection bypass ────────────────────────────────────────
    // Playwright usa Chrome DevTools Protocol. Alcuni detector cercano:
    // - window.__playwright / window.__pw_* artefatti
    // - Error stack trace con "Runtime.evaluate" o "__puppeteer_evaluation_script__"
    // - document.__webdriver_evaluate / __selenium_evaluate
    // - Debugger.scriptParsed artifacts nel prototype di Error
    try {
        // Pulisci artefatti CDP noti
        // H23: Updated artifact list with newer Playwright properties
        const cdpArtifacts = [
            '__playwright', '__pw_manual', '__pwresult', '__pw_d',
            '__pw_fetch_hook', '__pw_page_binding', '__PW_inspect',
            'cdc_adoQpoasnfa76pfcZLmcfl_Array', 'cdc_adoQpoasnfa76pfcZLmcfl_Promise', 'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
            '__webdriver_evaluate', '__selenium_evaluate',
            '__webdriver_script_function', '__webdriver_script_func',
            '__driver_evaluate', '__webdriver_unwrap',
            '__fxdriver_evaluate', '__driver_unwrap',
            'callPhantom', '_phantom', 'phantom',
            '__nightmare', 'domAutomation', 'domAutomationController'
        ];
        for (const prop of cdpArtifacts) {
            if (prop in window) {
                try { delete window[prop]; } catch {
                    try { Object.defineProperty(window, prop, { get: () => undefined, configurable: true }); } catch {}
                }
            }
            if (prop in document) {
                try { delete document[prop]; } catch {
                    try { Object.defineProperty(document, prop, { get: () => undefined, configurable: true }); } catch {}
                }
            }
        }

        // H23: Maschera stack trace CDP in Error.prepareStackTrace.
        // Wrap in try so the override itself doesn't throw. Filters __pw_fetch_hook and pptr: patterns.
        const originalPrepareStackTrace = Error.prepareStackTrace;
        try {
            Error.prepareStackTrace = function(error, structuredStackTrace) {
                try {
                    const filtered = structuredStackTrace.filter(frame => {
                        try {
                            const fn = frame.getFunctionName() || '';
                            const file = frame.getFileName() || '';
                            return !fn.includes('__puppeteer') &&
                                   !fn.includes('__playwright') &&
                                   !fn.includes('__pw_fetch_hook') &&
                                   !file.includes('pptr:') &&
                                   !file.includes('__playwright') &&
                                   !file.includes('pptr:');
                        } catch { return true; }
                    });
                    if (originalPrepareStackTrace) {
                        return originalPrepareStackTrace(error, filtered);
                    }
                    return filtered.map(f => '    at ' + f.toString()).join('\\n');
                } catch {
                    if (originalPrepareStackTrace) return originalPrepareStackTrace(error, structuredStackTrace);
                    return '';
                }
            };
        } catch {}
    } catch {}

    // ─── 18. [RIMOSSO] WebGL renderer consistency ─────────────────────────────
    // Rimosso: la patch WebGL è ora gestita UNICAMENTE in launcher.ts con un pool
    // di 12 renderer realistici (8 desktop ANGLE + 4 Apple) selezionati
    // deterministicamente per fingerprint. Avere due patch separate causava
    // sovrascrittura e incoerenza rilevabile (la seconda patch ignorava la prima).

    // ─── 19. iframe contentWindow.chrome consistency ──────────────────────────
    // Bot detector crea un iframe nascosto e controlla se contentWindow.chrome
    // esiste — in Playwright spesso è assente dentro iframe, tradendo l'automazione.
    // Firefox non ha window.chrome, quindi skippa per coerenza.
    if (!_isFirefox) try {
        const originalCreateElement = document.createElement.bind(document);
        document.createElement = function(tagName, options) {
            const el = originalCreateElement(tagName, options);
            if (tagName.toLowerCase() === 'iframe') {
                // Inietta chrome nel contentWindow quando l'iframe viene aggiunto al DOM
                setTimeout(() => {
                    try {
                        if (!el.contentWindow) return;
                        if (!el.contentWindow.chrome) {
                            el.contentWindow.chrome = window.chrome;
                        }
                    } catch {}
                }, 0);
            }
            return el;
        };
    } catch {}
})();`;
}
