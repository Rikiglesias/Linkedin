# LinkedIn Study 2026 — Anti-ban delta + mappa struttura per blindare i workflow

> Studio prodotto il 2026-06-08 (fan-out di ricerca `w3s73o157`: 5 agenti web+repo → 2 sintesi).
> Scopo: rispondere a due domande dell'utente — (1) **è cambiato qualcosa per l'anti-ban?** (non farci beccare),
> (2) **com'è strutturato LinkedIn** oggi, per adattare i workflow.
> Ogni claim cita la fonte: URL (ricerca web 2025-2026) o `file:riga` (nostro codice, verificato alla fonte).
> Le fonti complete (44 detection + 24 limiti) sono in fondo. **Verifica live dei selettori sul sito reale = leva utente** (login + account veri).

---

## TL;DR (executive summary)

**Sì, è cambiato — ma siamo messi bene.** Lo stack (Playwright + camoufox + risk engine + proxy Oxylabs) è in larga parte **già allineato** alla realtà 2026, e in alcuni punti la **supera** (timing log-normale reale, mouse Bézier multi-fase, navigazione organica senza `goto`, acceptance-rate già cablato nel risk engine, immunità strutturale ai marker CDP grazie a Firefox/Juggler).

I **3 cambiamenti chiave del 2026** non sono "nuovi numeri" ma uno spostamento di paradigma:
1. **Detection multi-layer correlata**: rete (TLS JA3/JA4 + HTTP/2/3, *prima* del JS) → fingerprint JS (consistenza cross-attributo) → biometria su **sequenze** (LSTM) → IP/ASN. Basta **una** incoerenza tra layer per alzare il risk score.
2. **Limiti dinamici per-account** (Trust Score): il weekly-invite non è più ~100 fisso ma ~80-200 su finestra rolling 7gg, governato più da **acceptance-rate** e **pending-ratio** che dal volume.
3. **Due tecniche nuove 2026** che attaccano proprio le difese a rumore: **BrowserGate/Spectroscopy** (aprile 2026: scansione estensioni + fingerprint cifrato come header su ogni API call) e il **consistency-check doppio-render** contro la randomizzazione canvas.

**Gap reali (verificati a codice), in ordine di rischio:**
- 🔴 **Site-check (`core/audit.ts`) scrive nel DB su selettori volatili senza fallback** → un rename UI corrompe lo stato lead in **silenzio** (rischio business #1).
- 🟠 **Cap di durata-sessione assente** (5-45min) — solo spacing tra azioni, non wall-clock.
- 🟠 **JA3/TLS reale** è metadata-only senza CycleTLS (bomba a innesco: pericoloso solo se si forza UA Firefox/Safari su engine chromium).
- 🟠 **Click Connect dell'invito senza Vision/drift** → un cambio UI rende gli inviti SKIPPED in silenzio.
- 🟡 timezone hardcoded `Europe/Rome` non legata al proxy; copertura selettori solo EN+IT (viola L7-LI.5); divergenza `Save in list` vs `Save to list`.

**Nessun panico, ma azione mirata**: i gap sono esattamente le incoerenze cross-layer che il modello 2026 correla. Backlog prioritizzato in **Parte 3**.

---

## Parte 1 — Anti-ban / detection: cosa è cambiato nel 2026

### 1.1 Il salto di paradigma

| Asse | Baseline nostra (research_dump, 22gg) | Realtà 2026 | Delta |
|---|---|---|---|
| Biometria | ML sul "ritmo"/rate dell'account | **LSTM su SEQUENZE** di azione (ogni request = token, + differenze temporali) | Non i delay isolati ma **struttura/ordine/eterogeneità** della sequenza |
| Rete | (non menzionata) | **TLS JA3/JA4 + HTTP/2/3** ispezionati *prima* del JS | **Nuovo asse**: i 3 layer devono "raccontare la stessa storia" |
| Fingerprint | "fingerprint coerente" | `getHasLiedOs()`/`getHasLiedLanguages()` reverse-engineerate: cross-check UA↔oscpu↔platform↔touch↔plugins↔GPU↔language | Sappiamo **esattamente** quali assi LinkedIn cross-checka in produzione |
| Limiti | ~80 azioni/giorno (floor statico) | **Trust Score dinamico** per-account; ~80-200 invite/sett rolling | Soffitto dinamico; **acceptance/pending sono le leve**, non il volume |
| Enforcement | IP datacenter blacklistati | **Vendor-level ban** (Apollo/Seamless/HeyReach/Proxycurl); 97.1% fake bloccati *prima* del report | "Stesso IP = automazione" → isolamento per-account obbligatorio |

### 1.2 Le tecniche nuove del 2026 (verificate da fonti recenti)

- **BrowserGate / "Spectroscopy"** (5 aprile 2026, BleepingComputer/Fairlinked): bundle JS da 2.7MB che (a) spara ~6.222 probe `chrome-extension://<id>/<file>` per rilevare le estensioni installate (461 nel 2024 → 6.167 a feb 2026, +1.252%), (b) raccoglie 48 attributi hardware, (c) cifra RSA e inietta il fingerprint come **header HTTP permanente su ogni chiamata API**. ➜ *Impatto su di noi: BASSO* — il probe è Chrome-specifico (`chrome-extension://`), camoufox-Firefox lo sidestepba, e il nostro browser gira **pulito** (zero estensioni). Non serve hardening **a patto di mantenere il profilo pulito**. [thenextweb, tomshardware, castle.io]
- **Consistency-check doppio-render** (NUOVO 2025): gli script renderizzano lo **stesso canvas due volte** e confrontano gli hash; se divergono → sei un anti-detect tool a randomizzazione. + attacco **Pixel-Recovery** ("Breaking the Shield", The Web Conference 2025). ➜ *La difesa corretta è rumore **deterministico per-sessione**, non per-chiamata* — che è esattamente ciò che facciamo (vedi 1.3). [multilogin, arxiv 2410.18233]
- **Fingerprint forgery detection — codice reale** (Castle.io, gen 2026): `getHasLiedOs()` flagga contraddizioni (UA Windows + platform Linux; UA mobile + GPU desktop; assenza `navigator.plugins`); `getHasLiedLanguages()` verifica `navigator.language` == `navigator.languages[0]`. [blog.castle.io]
- **Network fingerprinting pre-JS**: JA3 sta sfumando (TLS extension randomization di Chrome) → **JA4+** ormai standard 2026. HTTP/2: ordine pseudo-header (Chrome `m,a,s,p`; Firefox `m,p,a,s`), PRIORITY frames, WINDOW_UPDATE. ➜ *Vantaggio nostro: camoufox è **Firefox reale** → JA3/HTTP2 nativi autentici. Rischio = il **proxy** che termina/riscrive TLS.* [scrapfly, browserless, Cloudflare JA4]
- **Biometria LSTM su sequenze** (LinkedIn engineering blog, "abusive sequences"): "è difficile per i bot simulare i pattern sottili di sequenze organiche". Gli scraper producono pattern **omogenei**; gli umani **eterogenei**. ➜ *La difesa è la **varianza/eterogeneità della sequenza** (ordine non deterministico, azioni-rumore, interleave), non i limiti numerici.*
- **Trust Score dinamico** + soglie 2026: weekly-invite ~80-200 (rolling 7gg); acceptance critico ~30% (sotto 15% = restrizione quasi certa); **23% degli account ristretti pur restando dentro i limiti "ufficiali"** perché il feedback "I don't know this person" pesa più del volume. CUL free ~300 ricerche/mese (reset 1° del mese, mezzanotte PST). [linkedin help a550555/a526164, botdog, dux-soup]
- **Marker CDP morto nel 2025**: il classico signal error-stack side-effect per rilevare `Runtime.enable` (Puppeteer/Playwright-Chromium) è morto (commit V8, maggio 2025). ➜ *Irrilevante per noi (Firefox/Juggler, non CDP) — ma i competitor Chromium hanno un signal in meno.* [castle.io, rebrowser]

### 1.3 Dove siamo GIÀ allineati (verificato a codice)

| Difesa 2026 | Nostra implementazione (file:riga) | Verdetto |
|---|---|---|
| Timing log-normale (anti istogramma piatto LSTM) | `timingModel.ts:23-56` (Box-Muller + fatigue oraria), `utils/random.ts:37-53` (`logNormalDelayMs`) | ✅ Forma ex-gaussian reale dei flight-time |
| Mouse umano | `mouseGenerator.ts:89-150` (Bézier multi-fase + fractal noise + micro-tremor 8-12Hz + Fitts's-law); `humanClick.ts:29-60` jitter ≤3px; `missclick.ts:32-88` 2% solo su zone verificate non-pericolose | ✅ Stato dell'arte |
| Navigazione organica (no teletrasporto) | `navigationContext.ts:283-371` (nessun ramo fa `goto` diretto al target); `sessionWarmer.ts:33-190` (feed→notifiche→messaging→search→profilo) | ✅ Attenua il pattern omogeneo dell'LSTM |
| Acceptance-rate come leva anti-ban (Trust Score) | `riskEngine.ts:237` (weekly limit dinamico su età), `:405` (acceptanceFactor: ≥40%→0, <40%→penalità ≤25), `accountBehaviorModel.ts:198` (SSI 0.3/età 0.25/acceptance 0.25) | ✅ **Risposta diretta al cambiamento #1** (Trust Score) |
| Fingerprint coerente + noise deterministico | `stealthScripts.ts` (bypass getHasLiedOs/Languages, hw/mem dallo stesso seed); `launcher.ts:524-643` (canvas noise deterministico Mulberry32 seedato + WebGL coerente con device-class) | ✅ Difesa **corretta** vs consistency-check doppio-render |
| Immunità marker CDP/cdc_ + JA3/HTTP2 nativi | camoufox/Firefox (Juggler, non CDP) | ✅ **A patto** che `BROWSER_ENGINE=camoufox` in prod (default è `chromium`, `domains.ts:18-23`) |
| Proxy sticky + penalità DC/geo | `proxyManager.ts:695-745` (sticky per sessione+settimana, penalizza DC+1000/geo-mismatch+2000, no fallback IP diretto) | ✅ Isolamento per-account |
| Kill-switch su challenge/429 | `riskEngine.ts:19-59` (STOP su challenge); `launcher.ts:702` (429 Voyager → kill-switch globale) | ✅ Riconosce il warning prima dell'escalation |

### 1.4 I GAP reali anti-ban

- **GAP-1 (HIGH) — JA3/TLS reale assente senza CycleTLS.** `pool.ts:13-26` dichiara che i JA3 sono metadata ("Playwright always uses Chromium's TLS stack"); lo spoofing reale richiede `useJa3Proxy=true` (**default false**). `ja3Validator.ts:135-138` emette già il warning ma **solo `logWarn`**. Rischio **delimitato**: con chromium + `filterTlsCoherentPool` (solo UA Chrome/Edge) → coerente; con camoufox → JA3 Firefox reale → ok. Diventa ALTO **solo** se si forza UA Firefox/Safari su engine chromium. È una **bomba a innesco**.
- **GAP-2 (MEDIUM) — timezone non coerente per-fingerprint.** `domains.ts:16` hardcoda `Europe/Rome` globale; nessun fingerprint del pool popola `timezone` (verificato: 1 sola occorrenza = la definizione). Geo proxy risolta separatamente (`resolveProxyGeoip`). ➜ Se il proxy è US/UK ma tz resta Roma + locale it-IT → l'incoerenza geo↔tz↔locale che `proxy-rules.md #3` vieta e che il consistency-check + impossible-travel 2026 correlano. Non enforced: coperto solo se l'operatore allinea manualmente. Basso per IT-only/proxy-IT, sistematico per multi-geo.
- **GAP-3 (HIGH) — durata-sessione senza cap esplicito.** `scheduler.ts:500` usa `getSessionBudgetFactor()` come moltiplicatore di **budget**, non un wall-clock min/max. `scheduler-rules.md #3` richiede "5-45min, non maratone meccaniche". Lo spacing tra azioni è ben coperto (`interJobDelay` 30-120s + coffee-break), ma manca il cap che spezzi una run continua lunga = il signal "sessione non-umana" che alimenta l'LSTM. **Fix interno, additivo-restrittivo, nessun rischio anti-ban del cambio stesso.**
- **GAP-4 (MEDIUM, da validare a runtime) — WebRTC leak + versione camoufox.** `stealthScripts.ts` killa `RTCPeerConnection` e `block_webrtc` è default true, MA **non verificabile dal codice statico**: serve test empirico (browserleaks.com/webrtc dietro proxy reale) — uno STUN-leak dell'IP reale = mismatch fatale con l'IP proxy. + camoufox v146-beta è dichiarato sperimentale (gap manutenzione ~1 anno; fork mantenute CloverLabs/VulpineOS).
- **GAP-5 (LOW/strategico) — profilo `aggressive` tarato sopra la zona-rischio 2026.** `schema.ts:117,136`: `pendingRatioStop=0.7`, `weeklyInvite=180`. LinkedIn 2026 considera red-flag il pending già ~0.65 e silent reach-drop ~200 pending. Non è un bug (è opt-in per account maturi) ma il margine si è ristretto: usarlo solo con SSI>65/acceptance>40%/età>6 mesi.

> **Nota onestà**: BrowserGate/scansione-estensioni **non è un gap per noi** se il browser gira pulito (zero estensioni) — è un rischio per i competitor Chrome-extension-based, non per il nostro stack browser-nativo.

---

## Parte 2 — Struttura di LinkedIn 2026 + i nostri selettori

Il bot poggia su due mappe centrali — `src/selectors.ts` (28 chiavi, EN+IT) e `src/salesnav/selectors.ts` (ridondanza alta) — più selettori inline. **Robustezza a due velocità (verificata):** i flussi message/follow-up/bulk-save passano dal self-healing engine `uiFallback.ts` (dynamic selectors DB + ranking + drift-metric + Shadow DOM + Vision/LLaVA) e reggono i rename di classe; tre superfici ad alto impatto usano invece `count()`/`querySelector` **diretti senza fallback né Vision**.

### 2.1 Mappa strutturale per superficie

- **PROFILO (`/in/`)** — Framework **Artdeco** (Ember + SSR crescente; class CSS rinominate ~settimanalmente, id Ember `ember123` dinamici). Connect primario = `button.artdeco-button--primary` nella intro card, MA su profili **>500 connessioni o creator-mode** il primario diventa **Follow** e Connect migra **dentro l'overflow "More"** (rinominato **"Resources"** in alcuni casi da ott-2024), dropdown `artdeco-dropdown` **lazy-rendered** al click. Modal invito: "Add a note" (300 char, cap ~5/mese free → **la nota può essere assente**) vs "Send without a note". Classi headline/about volatili (`.text-body-medium`, `.pvs-entity`, `.t-bold`, `.t-14`).
- **RICERCA PERSONE (`/search/results/people/`)** — Card con Connect (`aria-label` "Invite <Name> to connect"). **Commercial Use Limit**: modal di upgrade dopo ~250-350 ricerche/mese free (reset 1° del mese 00:00 PST) che **blocca i risultati**. Anchor target `a[href*="/in/"]`.
- **INVITI / RETE (`/mynetwork/invitation-manager/`)** — `aria-label` localizzati con apostrofo **curvo** ("Accept <Name>'s invitation"); edge case "follows you" rende Accept come `<a>` non-cliccabile via CDP; paginazione via **reload URL**; limite 500 pending.
- **MESSAGGI (inbox)** — container `msg-*`; campo = `div[contenteditable][role=textbox]` (**non un input** → no `fill`, serve typing); cadenza battitura monitorata (0.01s/char = bot).
- **SALES NAVIGATOR (`/sales/*`)** — **App separata** con DOM proprio. Save-to-list a dropdown, virtual-scroller + paginazione Next, attributi semantici `data-x--lead--*` (più stabili). Limite 2.500 risultati/ricerca. Dati lato server (Voyager) → leggibili via response-intercept, ma **chiamate dirette = forte segnale automazione**.
- **FEED/HOME** — `feed-shared-update-v2`, `scaffold-finite-scroll`, virtualizzazione (post fuori viewport rimossi dal DOM). Per noi = **rumore organico anti-ban**, non azioni mirate.

### 2.2 Cross-reference: nostro selettore vs realtà 2026

| Superficie | Nostro selettore (file:riga) | Verdetto |
|---|---|---|
| Connect primario | `connectButtonPrimary` (`selectors.ts:17-22`) aria-label + `:has-text` EN+IT | 🟡 **Parzialmente allineato** — aria-label buono, ma chiave primaria `:has-text` localizzato; mitigato in inviteWorker ma senza Vision |
| Connect-in-overflow | `moreActionsButton` (`selectors.ts:24-31`) + doppio ramo (`inviteWorker.ts:68-83`) | 🟠 **Fragile** — ramo esiste, ma (1) **non copre il rename "Resources"**, (2) `humanDelay` fisso invece di `waitForSelector` sul lazy-render, (3) nessun Vision → rename = SKIP silenzioso |
| Message button / distance badge | `audit.ts:105-113` bare `count()`/`textContent()` (`.dist-value`, `msg-*`) | 🔴 **Stale-risk ALTO** — zero fallback/Vision/drift; il fallimento conta 0 → `connected/pendingInvite` **errati** → auto-fix DB sbagliati. **Rischio business #1** |
| Modal Add-note/Send | `selectors.ts:40-119` aria-label + has-text + XPath; `handleInviteModal` gestisce nota assente | 🟢 **Allineato** ma language-dependent (EN+IT) |
| Click target ricerca | `a[href*="/in/${slug}"]` (`navigationContext.ts:144`) | 🟢 **Allineato** (href = language-independent) ma single-point; **CUL non rilevato** = gap |
| Messaggi inbox | `messageTextbox` contenteditable+role (`selectors.ts:76-80`) via `clickWithFallback`+Vision | 🟢 **Robusto** (contract giusto + Vision) nonostante classi `msg-*` non verificate live |
| SalesNav save/select/next | `salesnav/selectors.ts` ridondanza alta + Vision/Computer-Use ultima risorsa | 🟢 **Più robusto** — `data-control-name='save_to_list'` language-independent; Vision regge i rename |
| SalesNav dati lead | `data-x--lead--*` (linkedinProfileScraper) | 🟢 **Buono** (attributi semantici stabili) |
| Scraper classic | `.text-body-medium`, `.pvs-entity`, `.t-bold` | 🟡 **Stale-risk** (utility class volatili, fallimento soft → personalization mancante) |

### 2.3 Rischi sistematici (trasversali)

1. **Dipendenza dalla LINGUA** — quasi ogni selettore d'azione è duplicato **solo EN+IT** (`CONNECT_BUTTON_KEYWORDS`, regex `detectInviteProof`/`detectWeeklyInviteLimit`). Viola `L7-LI.5` (IT/EN/FR/DE). Conseguenza differenziata: message/followup/bulksave **degradano al Vision** (recuperabile); **invite e site-check falliscono del tutto** (no Vision) → SKIP o stato lead corrotto. Contenuto per mono-account IT/EN, punto cieco per espansione mercati.
2. **Dipendenza dai MENU OVERFLOW** — su profili >500 conn/creator-mode Connect è nel dropdown lazy-render. Tre debolezze nostre: rename "Resources" assente, `humanDelay` fisso invece di attendere il render, nessun Vision dietro l'overflow.
3. **Integrity/iniezione (basso per noi)** — BrowserGate/integrity-check penalizzano l'**iniezione** DOM, non la lettura. Il nostro `page.evaluate` legge e `clickLocatorHumanLike` usa input nativo: allineato. Drift-metric (`uiFallback.measureSelectorDrift`) è l'early-warning giusto **ma copre solo i flussi self-healing** — `audit.ts`/scraper/inviteWorker-connect **non** ne beneficiano.

---

## Parte 3 — Azioni prioritizzate (backlog hardening)

> Le modifiche al codice saranno **inline** (mie) con `/antiban-review` + quality gate, **mai delegate**. Ordine per severity.

| # | Severity | Azione | Workflow/file | Fonte gap |
|---|---|---|---|---|
| 1 | 🔴 critical | **Site-check `audit.ts:105-113` dietro fallback engine + drift**; gateare l'auto-fix: se messageButton+distanceBadge+connectButton contano **tutti 0** sulla stessa pagina → body sospetto → **skip auto-fix + alert**, non corrompere lo stato DB | `core/audit.ts`, worker downstream | SR-1 |
| 2 | 🟠 high | **Cap di durata-sessione esplicito 5-45min** (log-normale) nello scheduler, con cooldown inter-sessione anche se il budget azioni non è esaurito | `scheduler.ts`, `sessionWarmer.ts` | GAP-3 |
| 3 | 🟠 high | **JA3↔UA incoerenza → kill-switch/skip** invece di solo `logWarn`; o `filterTlsCoherentPool` come hard-constraint a runtime | `proxy/ja3Validator.ts`, `launcher.ts`, `fingerprint/stealth.ts` | GAP-1 |
| 4 | 🟠 high | **Vision/fallback sul click Connect dell'invito** (`inviteWorker.ts:53-87`) come ultima risorsa prima di SKIP `connect_not_found` + drift-tracking | `inviteWorker` | SR-2 |
| 5 | 🟠 high | **Overflow menu rename/lazy-aware**: aggiungere "Resources"/"Risorse"; sostituire `humanDelay(700,1300)` fisso con `waitForSelector` sul menu item; gestire "Connect inesistente" come stato valido | `inviteWorker`, `selectors.ts:24-31` | SR-3 |
| 6 | 🟠 high | **Detection CUL** (Commercial Use Limit) nel flusso ricerca → stato di blocco + alert Telegram (WHAT/WHY/DO), stop ricerche fino al reset 1° del mese; budget ricerche < ~250/mese | `navigationContext`, site-check | SR-4 |
| 7 | 🟡 medium | **Test runtime WebRTC-leak** dietro proxy + check versione camoufox; se leak → fork mantenuta o patch | `launcher.ts`, `stealthScripts.ts` (staging) | GAP-4 |
| 8 | 🟡 medium | **timezone+locale legati al paese del proxy** deterministicamente per-fingerprint (popolare `pool.timezone` o derivarlo da `resolveProxyGeoip`); eliminare l'hardcode globale | `fingerprint/pool.ts`, `domains.ts`, `launcher.ts`, `proxy` | GAP-2 |
| 9 | 🟡 medium | **Consolidare divergenza `Save in list` vs `Save to list`**: far puntare `listActions.ts`/`listScraper.ts` alle stringhe centrali + test che fallisce su definizioni divergenti | salesnav bulk-save/create-list | SR-5 |
| 10 | 🟡 medium | **Copertura locale FR/DE/ES** sui selettori d'azione **oppure** rilevamento lingua UI a runtime + `getByRole` con name-regex tollerante (allineare a L7-LI.5) | `inviteWorker`, `audit.ts`, `navigationContext` | SR-6 |
| 11 | 🟢 low | **Guard profilo `aggressive`** opt-in (SSI>65/acc>40%/età>6m) + considerare default pending ~0.6 | `config/schema.ts`, doc | GAP-5 |
| 12 | 🟢 low | **Drift-tracking sugli scraper read-only** (classic): alert su null per N profili consecutivi | `linkedinProfileScraper`, `ssiScraper` | SR-7 |

---

## Note operative

- **Verifica live = leva utente**: i selettori esatti correnti di feed/profilo-overflow/messaggi/SalesNav **non sono verificabili senza login reale**; vanno ispezionati a runtime, mai hard-codati a memoria. Quando vorrai, smoke test su account+proxy veri.
- **Priorità di rischio**: 1 (silent DB corruption) > 2-6 (anti-ban + affidabilità invite/ricerca) > 7-10 > 11-12. I primi 6 sono il nucleo per "i workflow devono funzionare perfettamente + non farci beccare".
- **Continuità**: questo studio è tracciato in `~/todos/linkedin-study.md` (binding `/goal linkedin-study`); il backlog azioni è la tabella di Parte 3.

## Fonti

**Detection 2026 (selezione autorevole, 44 totali):** castle.io (forged-fingerprints, extension-detection, CDP-signal-dead), securityboulevard 2026, thenextweb/tomshardware/cloaked (BrowserGate), LinkedIn engineering (abusive-sequences LSTM, isolation-forest), scrapfly (JA3/HTTP2-HTTP3), browserless (TLS-fingerprinting Playwright), Cloudflare JA4, multilogin (canvas-myth), arxiv 2410.18233 (Breaking the Shield), browserleaks/dev.to (WebRTC 2026), github.com/daijro/camoufox + camoufox.com/stealth, proxies.sx (camoufox 2026).

**Limiti/enforcement 2026 (selezione, 24 totali):** linkedin.com/help (a550555 weekly-invite, a526164 CUL-reset, a106030 SalesNav, a564226), botdog (acceptance-study 16.492 inviti), dux-soup/joinvalley/connectsafely/growleads (safety 2026), linkedhelper (weekly-invite, pending), multilogin (shadow-bans), phantombuster (CUL), salesrobot/linkedsdr (limits guide).

**Codice nostro (verificato file:riga):** `timingModel.ts:23-56`, `utils/random.ts:37-53`, `mouseGenerator.ts:89-150`, `humanClick.ts:29-60`, `missclick.ts:32-88`, `navigationContext.ts:144,283-371`, `sessionWarmer.ts:33-190`, `riskEngine.ts:19-59,237,405`, `accountBehaviorModel.ts:198`, `stealthScripts.ts`, `launcher.ts:524-643,702`, `proxyManager.ts:695-745`, `proxy/pool.ts:6,13-26`, `proxy/ja3Validator.ts:135-138`, `config/domains.ts:16,18-23`, `config/schema.ts:117,136`, `core/audit.ts:105-113`, `workers/inviteWorker.ts:46,53-87,141-143`, `selectors.ts:17-119`, `salesnav/selectors.ts:35`, `salesnav/listActions.ts:38`.
