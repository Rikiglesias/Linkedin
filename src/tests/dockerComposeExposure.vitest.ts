/**
 * Sentinella: nessun servizio deve pubblicare una porta su tutte le interfacce di rete.
 *
 * `docker-compose.yml` esponeva Postgres (5432), n8n (5678) e la dashboard (80) su 0.0.0.0,
 * mentre `bot-api` era già legato a 127.0.0.1: bastava una riga scritta senza indirizzo per
 * rimetterle in rete, in silenzio. Questo test è il freno.
 *
 * Il file viene letto come testo di proposito: gli unici parser YAML presenti sono
 * dipendenze transitive non dichiarate in package.json, e appoggiarcisi le renderebbe
 * obbligatorie senza che nessuno l'abbia deciso.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const COMPOSE = path.resolve(__dirname, '../../docker-compose.yml');

/** Ritorna le voci della sezione `ports:` di ogni servizio, nell'ordine in cui compaiono. */
function publishedPorts(source: string): string[] {
    const lines = source.split(/\r?\n/);
    const entries: string[] = [];
    let insidePorts = false;
    let portsIndent = 0;

    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        const indent = line.length - line.trimStart().length;

        if (insidePorts) {
            const item = line.trim().match(/^-\s*"?([^"#]+?)"?\s*$/);
            if (item && indent > portsIndent) {
                entries.push(item[1].trim());
                continue;
            }
            if (indent <= portsIndent) insidePorts = false;
        }

        if (line.trim() === 'ports:') {
            insidePorts = true;
            portsIndent = indent;
        }
    }
    return entries;
}

describe('docker-compose — nessuna porta aperta verso la rete', () => {
    const source = readFileSync(COMPOSE, 'utf8');
    const ports = publishedPorts(source);

    it('trova le porte pubblicate (se questo fallisce, il test non sta leggendo nulla)', () => {
        expect(ports.length).toBeGreaterThanOrEqual(4);
    });

    it.each(ports)('la porta "%s" è pubblicata solo sulla macchina host', (entry) => {
        expect(entry.startsWith('127.0.0.1:')).toBe(true);
    });

    it('nessuna voce lega esplicitamente tutte le interfacce', () => {
        expect(ports.some((p) => p.startsWith('0.0.0.0:'))).toBe(false);
    });
});
