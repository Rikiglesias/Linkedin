import { describe, test, expect } from 'vitest';
import { escapeTelegramHtml } from '../telemetry/alerts';

// Ondata-3: i dati (title/message) vanno escapati prima di andare in parse_mode HTML, altrimenti
// caratteri come < > & rompono il markup e Telegram droppa l'alert (400).
describe('escapeTelegramHtml (Ondata-3)', () => {
    test('escapa i caratteri speciali HTML', () => {
        expect(escapeTelegramHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeTelegramHtml('a & b')).toBe('a &amp; b');
        expect(escapeTelegramHtml('1 < 2 > 0')).toBe('1 &lt; 2 &gt; 0');
    });

    test('ordine corretto: & escapato per primo (no doppio-escape)', () => {
        expect(escapeTelegramHtml('<')).toBe('&lt;');
        // '&lt;' di input non deve diventare '&amp;lt;' se passato di nuovo? qui input grezzo:
        expect(escapeTelegramHtml('&<>')).toBe('&amp;&lt;&gt;');
    });

    test('testo senza speciali → invariato', () => {
        expect(escapeTelegramHtml('Lista importata: 42 lead')).toBe('Lista importata: 42 lead');
    });
});
