/**
 * harnessIdentity.ts — identità del browser su Camoufox VERO, pagina locale, zero LinkedIn (C28; base di C23/C24).
 *
 * Perché su Camoufox e non su Chromium: il primo invito reale gira su Camoufox (C52) e l'identità che LinkedIn
 * vede è quella che Camoufox espone nativamente. Qui si legge ciò che la pagina vede (`navigator.*`) e ciò che
 * il server riceve (header `User-Agent`), e si pretende che coincidano: due identità per pagina = rilevabile.
 *
 * C23/C24 estenderanno questo file con il lancio DAL PATH DI PRODUZIONE (`.fingerprint.json`, 3 lanci
 * byte-identici, sezioni native). In C28 prova il cablaggio: Camoufox parte, la pagina locale viene servita
 * e contata, l'egress è negato.
 *
 * Uso:  npm run harness:identity   (= npx ts-node src/tests/harnessIdentity.ts)
 * Exit: 0 = misure nell'atteso, 1 = almeno una fuori atteso, 2 = sonda rotta (vedi harnessRuntime).
 */

// Il runtime va importato per PRIMO: isola env/sessionDir/DB prima che `src/config` venga caricato (C28).
import { runHarness } from './harnessRuntime';

type Measure = { name: string; got: unknown; expected: string; ok: boolean };

interface NavigatorSnapshot {
    userAgent: string;
    platform: string;
    oscpu: string | undefined;
    hardwareConcurrency: number;
    languages: readonly string[];
    screen: { width: number; height: number; colorDepth: number };
}

async function main(): Promise<void> {
    await runHarness('identity', 'camoufox', async (run) => {
        const { page } = run;
        await page.goto(run.echoHeadersUrl());
        const headers = JSON.parse(await page.locator('body').innerText()) as Record<string, string | undefined>;
        const uaHeader = headers['user-agent'] ?? '';

        const snapshot = await page.evaluate<NavigatorSnapshot>(() => ({
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            oscpu: (navigator as Navigator & { oscpu?: string }).oscpu,
            hardwareConcurrency: navigator.hardwareConcurrency,
            languages: navigator.languages,
            screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
        }));

        const measures: Measure[] = [
            {
                name: 'navigator.userAgent === header User-Agent ricevuto dal server locale',
                got: { uaJs: snapshot.userAgent, uaHeader },
                expected: 'stringhe identiche (una sola identità per pagina)',
                ok: snapshot.userAgent === uaHeader && uaHeader.length > 0,
            },
            {
                name: 'la UA è Gecko/Firefox (Camoufox, non Chromium)',
                got: snapshot.userAgent,
                expected: 'contiene "Gecko/" e "Firefox/"',
                ok: snapshot.userAgent.includes('Gecko/') && snapshot.userAgent.includes('Firefox/'),
            },
        ];

        console.log('\n=== IDENTITÀ — Camoufox vero, pagina locale, egress negato ===\n');
        console.log(`snapshot: ${JSON.stringify(snapshot)}\n`);
        let failed = 0;
        for (const m of measures) {
            if (!m.ok) failed++;
            console.log(`[${m.ok ? 'OK  ' : 'FAIL'}] ${m.name}`);
            console.log(`       atteso  : ${m.expected}`);
            console.log(`       misurato: ${JSON.stringify(m.got)}\n`);
        }
        console.log(failed === 0 ? 'Tutte le misure nell atteso.' : `${failed} misure fuori atteso.`);
        return failed;
    });
}

void main();
