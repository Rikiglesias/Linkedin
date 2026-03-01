/**
 * browser/stealth.ts
 * ─────────────────────────────────────────────────────────────────
 * Fingerprint selection + anti-bot init script iniettato nelle pagine.
 */

export interface CloudFingerprint {
    userAgent: string;
    viewport?: { width: number; height: number };
}

export interface BrowserFingerprint {
    userAgent: string;
    viewport: { width: number; height: number };
}

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1280, height: 720 },
];

function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function pickBrowserFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>): BrowserFingerprint {
    if (cloudFingerprints.length > 0) {
        const fp = randomElement(cloudFingerprints);
        return {
            userAgent: fp.userAgent,
            viewport: fp.viewport ?? randomElement(VIEWPORTS),
        };
    }

    return {
        userAgent: randomElement(USER_AGENTS),
        viewport: randomElement(VIEWPORTS),
    };
}

export const STEALTH_INIT_SCRIPT = `
    // 1. Defeat navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    
    // 2. Mock hardwareConcurrency and deviceMemory
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    
    // 3. Mock plugins & mimeTypes
    if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'mhjimiaplmpugondwaidnpafkincn', description: '' },
                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
            ]
        });
    }

    // 4. Spoof WebGL Vendor/Renderer
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Google Inc. (Apple)';
        if (parameter === 37446) return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
        return getParameter.apply(this, arguments);
    };

    // 5. Canvas Fingerprint Noise
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
        const context = this.getContext('2d');
        if (context) {
            const width = this.width;
            const height = this.height;
            context.fillStyle = 'rgba(255,255,255,0.01)';
            context.fillText('stealth', Math.random() * width, Math.random() * height);
        }
        return originalToDataURL.apply(this, arguments);
    };
    
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function() {
        const imageData = originalGetImageData.apply(this, arguments);
        for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (Math.random() * 2 - 1)));
        }
        return imageData;
    };

    // 6. AudioContext Fingerprint Noise
    const audioContextFunc = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (audioContextFunc) {
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function() {
            const results = originalGetChannelData.apply(this, arguments);
            for (let i = 0; i < results.length; i += 100) {
                results[i] = results[i] + (Math.random() * 0.0000001 - 0.00000005);
            }
            return results;
        };
    }

    // 7. WebRTC IP Leak Prevention (Fake RTCPeerConnection)
    if (window.RTCPeerConnection) {
        const OriginalRTCPeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = function(...args) {
            const pc = new OriginalRTCPeerConnection(...args);
            pc.createDataChannel = () => ({ close: () => {} });
            pc.createOffer = () => Promise.resolve({ type: 'offer', sdp: '' });
            return pc;
        };
        window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
    }

    // 8. Delete Playwright CDP Traces (cdc_*)
    for (const key of Object.keys(window)) {
        if (key.match(/^cdc_[a-zA-Z0-9]+_/)) {
            try { delete window[key]; } catch {}
        }
    }

    // 9. Hardware & Sensor Mocks
    if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') return Promise.resolve({ state: 'denied', onchange: null });
            if (parameters.name === 'geolocation') return Promise.resolve({ state: 'prompt', onchange: null });
            return originalQuery(parameters);
        };
    }
    Object.defineProperty(navigator, 'getBattery', { get: () => undefined });
`;
