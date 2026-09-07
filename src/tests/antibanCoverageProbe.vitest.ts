/**
 * antibanCoverageProbe.vitest.ts — C64: la sonda della copertura anti-ban fa il suo mestiere.
 *
 * I casi negativi del criterio sono stati provati a mano su un branch usa-e-getta, ma una prova fatta
 * a mano non resta: al prossimo refactor della sonda nessuno la rifà. Qui la sonda viene ESEGUITA
 * davvero (`spawnSync`, come `enginePin.vitest.ts` fa con la sua), su artefatti sintetici e su un
 * range di commit STORICO — quindi immutabile: il test non si rompe quando il repo va avanti.
 *
 * La domanda che ogni caso pone è una sola: questa sonda può dare un falso VERDE? Se può, il criterio
 * C64 non vale nulla, perché il gate direbbe «coperto» su un blocco che non lo è.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SONDA = path.join(ROOT, 'scripts', 'probe', 'antiban-coverage.cjs');

/** Commit di C53: nel perimetro anti-ban tocca UN solo file, `src/browser/launcher.ts`. */
const RANGE = 'e9fc93e~1..e9fc93e';
const FILE_NEL_PERIMETRO = 'src/browser/launcher.ts';

const temporanee: string[] = [];
afterEach(() => {
    for (const dir of temporanee.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c64-sonda-'));
    temporanee.push(dir);
    return dir;
}

function blobDi(file: string, ref = 'e9fc93e'): string {
    const res = spawnSync('git', ['-C', ROOT, 'rev-parse', `${ref}:${file}`], { encoding: 'utf8' });
    expect(res.status, `git rev-parse ${ref}:${file}`).toBe(0);
    return res.stdout.trim();
}

interface Esito {
    status: number | null;
    ok?: boolean;
    uncovered: string[];
    stale: string[];
    notSafe: string[];
    stderr: string;
}

function esegui(args: string[], verdictsPath?: string): Esito {
    const res = spawnSync(process.execPath, [SONDA, ...args], {
        encoding: 'utf8',
        env: verdictsPath === undefined ? process.env : { ...process.env, ANTIBAN_COVERAGE_VERDICTS: verdictsPath },
    });
    let dati: Record<string, unknown> = {};
    try {
        dati = JSON.parse(res.stdout) as Record<string, unknown>;
    } catch {
        // exit 2 non stampa JSON: i campi restano vuoti e il caso si giudica sullo status.
    }
    return {
        status: res.status,
        ok: dati.ok as boolean | undefined,
        uncovered: (dati.uncovered as string[]) ?? [],
        stale: (dati.stale as Array<{ file: string }>)?.map((s) => s.file) ?? [],
        notSafe: (dati.not_safe as Array<{ file: string }>)?.map((n) => n.file) ?? [],
        stderr: res.stderr ?? '',
    };
}

/** Artefatto sintetico: il blob lo legge da git, così la voce nasce coerente col contenuto vero. */
function artefatto(voci: Array<{ file: string; blob?: string; verdict?: string }>): string {
    const percorso = path.join(tmp(), 'verdicts.json');
    fs.writeFileSync(
        percorso,
        JSON.stringify({
            schema: 1,
            verdicts: voci.map((v) => ({
                file: v.file,
                blob_sha: v.blob ?? blobDi(v.file),
                answers: ['browser_behavior: SICURO — finto', '', '', '', '', ''],
                verdict: v.verdict ?? 'SICURO',
                commit: 'x'.repeat(40),
                date: '2026-09-07',
                criterio: 'test',
                vincolo: null,
            })),
        }),
        'utf8',
    );
    return percorso;
}

describe('C64 — la sonda della copertura anti-ban', () => {
    it('artefatto completo e coerente: VERDE, exit 0', () => {
        const esito = esegui(['--json', RANGE], artefatto([{ file: FILE_NEL_PERIMETRO }]));
        expect(esito.status).toBe(0);
        expect(esito.ok).toBe(true);
        expect(esito.uncovered).toEqual([]);
        expect(esito.stale).toEqual([]);
    });

    it('file del perimetro SENZA voce: exit 1 e il file elencato (caso negativo ① del criterio)', () => {
        const esito = esegui(['--json', RANGE], artefatto([]));
        expect(esito.status).toBe(1);
        expect(esito.ok).toBe(false);
        expect(esito.uncovered).toContain(FILE_NEL_PERIMETRO);
    });

    it('voce presente ma il file è cambiato dopo la review: exit 1 e il file è STALE, non coperto (caso ②)', () => {
        const percorso = artefatto([{ file: FILE_NEL_PERIMETRO, blob: '0'.repeat(40) }]);
        const esito = esegui(['--json', RANGE], percorso);
        expect(esito.status).toBe(1);
        expect(esito.stale).toContain(FILE_NEL_PERIMETRO);
        expect(esito.uncovered).toEqual([]);
    });

    it('voce con verdetto diverso da SICURO: non vale come copertura', () => {
        const esito = esegui(['--json', RANGE], artefatto([{ file: FILE_NEL_PERIMETRO, verdict: 'ATTENZIONE' }]));
        expect(esito.status).toBe(1);
        expect(esito.notSafe).toContain(FILE_NEL_PERIMETRO);
    });

    it('la voce vale per il FILE giusto: coprire un altro file non copre questo', () => {
        // Il rischio è una sonda che conta le voci invece di associarle: qui l'artefatto ha una voce
        // valida, ma su un file diverso da quello toccato nel range.
        const esito = esegui(['--json', RANGE], artefatto([{ file: 'src/fingerprint/noiseGenerator.ts' }]));
        expect(esito.status).toBe(1);
        expect(esito.uncovered).toContain(FILE_NEL_PERIMETRO);
    });

    it('artefatto assente: exit 2 (non può misurare), MAI 0', () => {
        const esito = esegui(['--json', RANGE], path.join(tmp(), 'non-esiste.json'));
        expect(esito.status).toBe(2);
        expect(esito.stderr).toContain('non in grado di misurare');
    });

    it('artefatto con JSON valido ma senza elenco di verdetti: nessuna copertura, mai verde', () => {
        const percorso = path.join(tmp(), 'strano.json');
        fs.writeFileSync(percorso, JSON.stringify({ schema: 1, verdicts: 'non-un-array' }), 'utf8');
        const esito = esegui(['--json', RANGE], percorso);
        expect(esito.status).toBe(1);
        expect(esito.uncovered).toContain(FILE_NEL_PERIMETRO);
    });

    it('range assente o non risolvibile: exit 2, non un verde silenzioso', () => {
        expect(esegui([]).status).toBe(2);
        expect(esegui(['--json', 'ref-che-non-esiste-c64..HEAD'], artefatto([])).status).toBe(2);
    });

    it('il blob si legge sull’estremo DESTRO del range, non su HEAD (falso verde silenzioso)', () => {
        // Range STORICO che non finisce a HEAD: `d347f94~1..d347f94` (commit di C27, tocca il
        // launcher). Lì il contenuto vero del file è `b0d46f2a`, mentre a HEAD è `d2a051aa` perché
        // C53 l'ha cambiato dopo. Una sonda che legge `HEAD:<file>` invece dell'estremo destro
        // chiamerebbe SCADUTA una voce corretta, e COPERTA una voce che descrive un contenuto che in
        // quel range non esisteva ancora: falso rosso e falso verde dallo stesso difetto.
        const RANGE_STORICO = 'd347f94~1..d347f94';
        const TOCCATI = [
            'src/browser/auth.ts',
            'src/browser/launcher.ts',
            'src/browser/loginFailurePolicy.ts',
            'src/browser/sessionCookieMonitor.ts',
            'src/risk/incidentManager.ts',
            'src/risk/loginFailureHandler.ts',
        ];
        const alRange = blobDi(FILE_NEL_PERIMETRO, 'd347f94');
        const aHead = blobDi(FILE_NEL_PERIMETRO, 'HEAD');
        expect(alRange).not.toBe(aHead);

        const corretta = esegui(
            ['--json', RANGE_STORICO],
            artefatto(TOCCATI.map((f) => ({ file: f, blob: blobDi(f, 'd347f94') }))),
        );
        expect(corretta.status).toBe(0);
        expect(corretta.stale).toEqual([]);

        const conBlobDiHead = esegui(
            ['--json', RANGE_STORICO],
            artefatto(
                TOCCATI.map((f) => ({ file: f, blob: f === FILE_NEL_PERIMETRO ? aHead : blobDi(f, 'd347f94') })),
            ),
        );
        expect(conBlobDiHead.status).toBe(1);
        expect(conBlobDiHead.stale).toContain(FILE_NEL_PERIMETRO);
    });

    it('i test non entrano nel perimetro: il file di test del range non viene mai chiesto', () => {
        const esito = esegui(['--json', RANGE], artefatto([{ file: FILE_NEL_PERIMETRO }]));
        expect(esito.uncovered).not.toContain('src/tests/identityInitSessionDir.vitest.ts');
        expect(esito.status).toBe(0);
    });
});
