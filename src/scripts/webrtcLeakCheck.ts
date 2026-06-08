/**
 * scripts/webrtcLeakCheck.ts
 * ─────────────────────────────────────────────────────────────────
 * Diagnostico #7 (docs/research/LINKEDIN_STUDY_2026.md, backlog hardening):
 * verifica a RUNTIME, su browser reale + proxy reale, che la protezione WebRTC
 * tenga e NON ci sia uno STUN-leak dell'IP vero dietro il proxy.
 *
 * NON tocca LinkedIn: naviga solo su endpoint di test (api.ipify.org per leggere
 * l'IP di uscita reale = quello del proxy, e browserleaks.com/webrtc per l'eyeball
 * umano). Riusa `launchBrowser` AS-IS: nessun cambio fingerprint / timing / volumi /
 * azioni LinkedIn -> impatto anti-ban nullo (verdetto /antiban-review: SICURO).
 *
 * Cosa controlla (test autorevole, indipendente dal markup di browserleaks):
 *   - `RTCPeerConnection` / `webkitRTCPeerConnection` / `mozRTCPeerConnection` devono
 *     essere `undefined` (li uccide stealthScripts.ts:82-101). Se uno e' disponibile,
 *     la protezione e' REGREDITA -> FAIL.
 *   - Se per qualche motivo l'RTC e' disponibile, tenta di raccogliere ICE candidate
 *     contro uno STUN pubblico per qualche secondo: ogni candidate con IP = canale che
 *     puo' leakare l'IP reale bypassando il proxy.
 *
 * Uso:
 *   npm run webrtc:leak-check               (headful di default: apre la finestra per l'eyeball)
 *   npm run webrtc:leak-check -- --headless (solo verdetto programmatico, niente finestra)
 *
 * Esito: exit 0 = PASS (WebRTC killato, nessun candidate ICE) | exit 1 = FAIL (RTC disponibile o leak).
 */
import { config } from '../config';
import { launchBrowser, closeBrowser } from '../browser/launcher';
import { getProxyFailoverChainAsync, getStickyProxy, type ProxyConfig } from '../proxyManager';
import { hasOption as hasFlag } from '../cli/cliParser';

const IPIFY_URL = 'https://api.ipify.org?format=json';
const BROWSERLEAKS_URL = 'https://browserleaks.com/webrtc';
const STUN_GATHER_MS = 4000;
const HEADFUL_DWELL_MS = 8000;

interface WebrtcProbe {
    rtcAvailable: boolean;
    candidates: string[];
    ips: string[];
    error: string | null;
}

// Script eseguito DENTRO la pagina del browser reale (passato come stringa a page.evaluate,
// come stealthScripts.ts: evita la dipendenza da `lib.dom` nel tsconfig backend).
function buildProbeScript(gatherMs: number): string {
    return `(async () => {
        const Ctor = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (typeof Ctor !== 'function') {
            return { rtcAvailable: false, candidates: [], ips: [], error: null };
        }
        return await new Promise((resolve) => {
            const candidates = [];
            const ipSet = new Set();
            const ipRe = /(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})|([a-f0-9]{1,4}(?::[a-f0-9]{0,4}){3,7})/i;
            let pc;
            try {
                pc = new Ctor({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            } catch (e) {
                resolve({ rtcAvailable: true, candidates: [], ips: [], error: 'construct_failed:' + (e && e.message) });
                return;
            }
            pc.onicecandidate = (ev) => {
                if (!ev || !ev.candidate) return;
                const line = ev.candidate.candidate || '';
                if (!line) return;
                candidates.push(line);
                const m = line.match(ipRe);
                if (m && m[0] && !/\\.local$/i.test(m[0])) ipSet.add(m[0]);
            };
            try {
                pc.createDataChannel('leak-test');
                pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
            } catch (e) { /* ignore */ }
            setTimeout(() => {
                try { pc.close(); } catch (e) { /* ignore */ }
                resolve({ rtcAvailable: true, candidates, ips: Array.from(ipSet), error: null });
            }, ${gatherMs});
        });
    })()`;
}

async function resolveTestProxy(sessionDir: string): Promise<{ proxy: ProxyConfig | undefined; managed: boolean }> {
    const managed =
        config.proxyUrl.trim().length > 0 ||
        config.proxyListPath.trim().length > 0 ||
        !!config.proxyProviderApiEndpoint;
    if (!managed) return { proxy: undefined, managed: false };
    // Fail-closed come createProfile (AB-24): se il pool e' vuoto, NON ripiegare su IP diretto —
    // un leak-test su IP diretto non verifica nulla (l'IP "di uscita" sarebbe gia' quello reale).
    const proxy =
        (await getStickyProxy(sessionDir, {}, sessionDir)) ??
        (
            await getProxyFailoverChainAsync({
                preferredType: config.proxyMobilePriorityEnabled ? 'mobile' : undefined,
            })
        )[0];
    if (!proxy) {
        throw new Error(
            'webrtc-leak-check: managed proxy abilitato ma nessun proxy risolto. ' +
                'Impossibile testare il leak dietro proxy: controllare pool/provider/file. ' +
                '(Per testare comunque solo il kill RTC su IP diretto, lanciare con --allow-direct.)',
        );
    }
    return { proxy, managed: true };
}

export async function runWebrtcLeakCheck(args: string[] = []): Promise<boolean> {
    const headless = hasFlag(args, '--headless');
    const allowDirect = hasFlag(args, '--allow-direct');
    const sessionDir = config.sessionDir;

    let proxy: ProxyConfig | undefined;
    let managed = false;
    if (allowDirect) {
        // Bypass TOTALE del proxy: salta del tutto la risoluzione (e quindi il path camoufox publicIP-attraverso-proxy
        // che fallisce con 407 se l'auth proxy ha problemi). Isola il test WebRTC dal proxy: verifica SOLO il kill RTC
        // (RTCPeerConnection undefined). NB: l'IP di uscita sara' quello reale, NON il proxy → la dimensione
        // "leak-dietro-proxy" non e' coperta, ma se l'RTC e' killato non c'e' alcun canale da leakare comunque.
        console.warn('[WEBRTC_LEAK] --allow-direct: bypass TOTALE del proxy → IP diretto. Verifico SOLO il kill RTC, non il leak-dietro-proxy.');
    } else {
        const resolved = await resolveTestProxy(sessionDir);
        proxy = resolved.proxy;
        managed = resolved.managed;
    }

    console.log('[WEBRTC_LEAK] ── Diagnostico #7 WebRTC leak ──────────────────────────');
    console.log(`[WEBRTC_LEAK] engine=${config.browserEngine} headless=${headless} proxy=${managed ? 'managed' : 'DIRETTO (nessun proxy gestito)'}`);

    const session = await launchBrowser({
        sessionDir,
        headless,
        proxy,
        bypassProxy: !managed,
    });

    let egressIp = 'sconosciuto';
    let probe: WebrtcProbe = { rtcAvailable: true, candidates: [], ips: [], error: 'probe non eseguito' };
    try {
        const page = session.page;

        // 1) IP di uscita reale (= quello che il mondo vede). Con proxy attivo DEVE essere il proxy.
        try {
            await page.goto(IPIFY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const body = (await page.locator('body').innerText()).trim();
            const match = body.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|([a-f0-9:]{6,})/i);
            egressIp = match?.[0] ?? body.slice(0, 80);
        } catch (e) {
            egressIp = `errore-fetch (${(e as Error).message})`;
        }
        console.log(`[WEBRTC_LEAK] IP di uscita (visto dal mondo): ${egressIp}`);
        if (managed) {
            console.log('[WEBRTC_LEAK]   ^ DEVE corrispondere all\'IP del proxy, non al tuo IP reale.');
        }

        // 2) Test WebRTC autorevole sulla pagina browserleaks (init-script stealth gia' attivo nel context).
        await page.goto(BROWSERLEAKS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        probe = (await page.evaluate(buildProbeScript(STUN_GATHER_MS))) as WebrtcProbe;

        if (!headless) {
            console.log(`[WEBRTC_LEAK] Finestra aperta su browserleaks per ${Math.round(HEADFUL_DWELL_MS / 1000)}s — controlla a occhio la sezione "WebRTC".`);
            await page.waitForTimeout(HEADFUL_DWELL_MS);
        }
    } finally {
        await closeBrowser(session).catch(() => {});
    }

    // Verdetto: PASS sse e solo se l'RTC e' stato killato (constructor undefined).
    // Se l'RTC e' disponibile la protezione e' regredita, e ogni candidate raccolto e' un canale di leak.
    const leakedIps = probe.ips.filter((ip) => ip !== egressIp && !/^0\.0\.0\.0$/.test(ip));
    const pass = probe.rtcAvailable === false && probe.candidates.length === 0;

    console.log('[WEBRTC_LEAK] ── Risultato ───────────────────────────────────────────');
    console.log(`[WEBRTC_LEAK] RTCPeerConnection disponibile nella pagina: ${probe.rtcAvailable ? 'SI (REGRESSIONE)' : 'no (killato ✓)'}`);
    console.log(`[WEBRTC_LEAK] ICE candidate raccolti: ${probe.candidates.length}`);
    if (probe.ips.length > 0) console.log(`[WEBRTC_LEAK] IP esposti via WebRTC: ${probe.ips.join(', ')}`);
    if (leakedIps.length > 0) console.log(`[WEBRTC_LEAK] ⚠ IP che NON sono l'egress del proxy (possibile IP reale leakato): ${leakedIps.join(', ')}`);
    if (probe.error) console.log(`[WEBRTC_LEAK] note: ${probe.error}`);

    if (pass) {
        console.log('[WEBRTC_LEAK] ✅ PASS — WebRTC neutralizzato, nessun leak. La protezione tiene a runtime.');
    } else {
        console.log('[WEBRTC_LEAK] 🔴 FAIL — WebRTC NON neutralizzato a runtime. Verificare versione camoufox (v146-beta),');
        console.log('[WEBRTC_LEAK]            block_webrtc (launcher.ts:465) e lo stealth init-script (stealthScripts.ts:82-101).');
    }
    return pass;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const pass = await runWebrtcLeakCheck(args);
    process.exitCode = pass ? 0 : 1;
}

// Eseguito solo se invocato direttamente (node dist/scripts/webrtcLeakCheck.js via `npm run webrtc:leak-check`),
// non se importato. NB: gira COMPILATO, non con ts-node — ts-node intercetta i require('.js') dei loader nativi
// (impit, tirato da camoufox-js) e rompe il binding; il bot lancia il browser sempre da dist/ (come create-profile).
if (require.main === module) {
    main().catch((error) => {
        console.error('[WEBRTC_LEAK_ERROR]', error);
        process.exit(1);
    });
}
