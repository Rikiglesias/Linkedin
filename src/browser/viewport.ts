import type { Page } from 'playwright';

/**
 * Dimensioni REALI dell'area di pagina, per chi deve mappare coordinate su pixel.
 *
 * 🔴 Perche' esiste (2026-08-05, estratta da `salesnav/visionNavigator.ts` dove era locale):
 * `page.viewportSize()` restituisce `null` quando il context nasce con `viewport: null`, e questo
 * NON e' il caso raro: `HEADLESS` e' `false` di default (`config/domains.ts`) e in non-headless
 * `launcher.ts` usa proprio `viewport: null` + `--start-maximized`, per lasciare che sia la finestra
 * a decidere. Quindi nella configurazione NORMALE `viewportSize()` e' null, e ogni
 * `viewportSize() ?? { width: 1280, height: 800 }` sparso nel codice sta lavorando su una misura
 * INVENTATA: un click calcolato su 1280x800 mentre la finestra e' 1920x1080 non e' impreciso di
 * qualche pixel — tutto cio' che sta oltre 1279/799 viene schiacciato sul bordo.
 *
 * Ordine: viewport dichiarato (headless) -> `window.innerWidth/innerHeight` (la finestra vera) ->
 * `null` = **non lo so**. Il `null` va propagato, non sostituito con un default: chi mappa
 * coordinate deve poter decidere di NON agire (10o principio anti-ban: dichiara in quale ramo cade
 * il default; un default silenzioso qui autorizza il click cieco).
 */
export async function dimensioniFinestra(page: Page): Promise<{ width: number; height: number } | null> {
    const dichiarato = page.viewportSize();
    if (dichiarato && dichiarato.width > 0 && dichiarato.height > 0) return dichiarato;

    try {
        const misurato = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
        }));
        if (misurato && misurato.width > 0 && misurato.height > 0) return misurato;
    } catch {
        // Pagina chiusa, navigazione in corso, context distrutto: la domanda non ha risposta ORA.
        // Lo swallow e' voluto e completo: non c'e' niente da propagare (chi chiama non puo' fare
        // nulla con l'eccezione, mentre PUO' agire sul null), e rilanciare qui trasformerebbe una
        // misura mancante in un errore che rompe un flusso di navigazione perfettamente valido.
        return null;
    }

    return null;
}

/**
 * Dimensioni di uno screenshot PNG lette dal suo header IHDR.
 *
 * Serve dove la region dichiarata DEVE coincidere con lo spazio in cui il provider di vision legge
 * le coordinate: l'immagine e' la fonte di verita' di se stessa, mentre il viewport e' una misura
 * presa altrove che puo' non corrispondere (uno screenshot full-window contro un viewport dichiarato
 * a 1280x800 produce coordinate clampate sul bordo, cioe' click sul punto sbagliato).
 *
 * Offset RELATIVI AL FILE (non al chunk): 8 byte di signature, poi il chunk IHDR = 4 di length +
 * 4 di type ("IHDR" a 12-15), quindi width uint32 big-endian a 16 e height a 20. La spec W3C elenca
 * width/height a 8/12 perche' conta dall'inizio del CHUNK: stessa cosa, riferimento diverso.
 * Verificato su un PNG reale 16x16 prima di scrivere questa funzione.
 * Ritorna `null` se il buffer non e' un PNG valido — e anche qui il null si propaga, non si inventa.
 */
export function dimensioniPng(buffer: Buffer): { width: number; height: number } | null {
    if (buffer.length < 24) return null;
    if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width <= 0 || height <= 0) return null;

    return { width, height };
}
