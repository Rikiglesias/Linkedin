#!/usr/bin/env node
'use strict';
/**
 * Sonda C64 (goal `bot-operativo`) — nessun blocco si dichiara chiuso finché ogni file LinkedIn-touch
 * toccato nel blocco ha un verdetto `/antiban-review` = SICURO registrato in un artefatto VERSIONATO.
 *
 * Il perimetro lo calcola QUESTO comando, non chi scrive il codice: la memoria del builder è
 * esattamente ciò di cui il criterio non si fida. Read-only puro: `git diff --name-only`,
 * `git rev-parse <ref>:<file>` e la lettura di `docs/antiban/verdicts.json`. Non scrive nulla, non
 * apre browser, non tocca la rete.
 *
 * Il verdetto SCADE quando il file cambia: la voce registra il `blob_sha` recensito e la sonda lo
 * confronta con il blob ATTUALE. Un file già recensito e poi ri-modificato torna `stale`, non
 * `covered` — un verdetto vecchio su un contenuto nuovo è peggio di nessun verdetto.
 *
 * Uso:  node scripts/probe/antiban-coverage.cjs <sha-base>..HEAD
 *       node scripts/probe/antiban-coverage.cjs <sha-base> HEAD
 *       node scripts/probe/antiban-coverage.cjs --json <range>
 *
 * EXPECT (binding C64): exit 0 con `uncovered` e `stale` vuoti; exit 1 se un file del perimetro non ha
 * voce, ha una voce scaduta o ha un verdetto diverso da SICURO; exit 2 se la sonda stessa non può
 * misurare (range assente, git non disponibile, artefatto illeggibile) — un errore di misura non deve
 * mai passare per «tutto coperto».
 *
 * Override per i casi negativi del test: `ANTIBAN_COVERAGE_VERDICTS` (percorso dell'artefatto).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const verdictsPath = process.env.ANTIBAN_COVERAGE_VERDICTS
    ? path.resolve(process.env.ANTIBAN_COVERAGE_VERDICTS)
    : path.join(repoRoot, 'docs', 'antiban', 'verdicts.json');

/**
 * Il perimetro anti-ban: i file dove una modifica può cambiare identità, timing, volumi o un gate.
 * Prefissi di cartella + file singoli nominati (glob di `.claude/rules/browser-antiban.md` esteso dal
 * criterio C64). Cambiarlo = rinegoziare il contratto, non ritoccare qui in silenzio.
 */
const PERIMETRO_CARTELLE = Object.freeze([
    'src/browser/',
    'src/risk/',
    'src/salesnav/',
    'src/captcha/',
    'src/workers/',
    'src/proxy/',
    'src/fingerprint/',
    'src/config/',
]);
const PERIMETRO_FILE = Object.freeze([
    'src/core/scheduler.ts',
    'src/core/workflowEntryGuards.ts',
    'src/ai/aiDecisionEngine.ts',
]);

function git(args) {
    const res = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
    if (res.error) throw new Error(`git ${args.join(' ')}: ${res.error.message}`);
    return res;
}

function gitOrFail(args) {
    const res = git(args);
    if (res.status !== 0) {
        throw new Error(`git ${args.join(' ')} → exit ${res.status}: ${(res.stderr || '').trim()}`);
    }
    return res.stdout;
}

/** `src/browser/auth.ts` sì, `src/tests/**` no: i test non parlano a LinkedIn. */
function nelPerimetro(file) {
    const normalizzato = file.replace(/\\/g, '/');
    if (normalizzato.startsWith('src/tests/')) return false;
    if (!/\.(ts|cts|mts|js|cjs|mjs)$/.test(normalizzato)) return false;
    return (
        PERIMETRO_CARTELLE.some((prefisso) => normalizzato.startsWith(prefisso)) ||
        PERIMETRO_FILE.includes(normalizzato)
    );
}

/** Accetta `A..B`, `A...B` e la coppia `A B`; senza range non si indovina, si esce con 2. */
function leggiRange(args) {
    if (args.length === 1 && /\.{2,3}/.test(args[0])) return args[0];
    if (args.length === 2) return `${args[0]}..${args[1]}`;
    if (args.length === 1) return `${args[0]}..HEAD`;
    return null;
}

function caricaVerdetti() {
    if (!fs.existsSync(verdictsPath)) {
        throw new Error(`artefatto dei verdetti assente: ${verdictsPath} (C64: il verdetto vive nel repo, non nel binding)`);
    }
    const dati = JSON.parse(fs.readFileSync(verdictsPath, 'utf8'));
    const elenco = Array.isArray(dati.verdicts) ? dati.verdicts : [];
    const perFile = new Map();
    for (const voce of elenco) {
        if (voce && typeof voce.file === 'string') perFile.set(voce.file.replace(/\\/g, '/'), voce);
    }
    return perFile;
}

function main() {
    const jsonOut = process.argv.includes('--json');
    const range = leggiRange(process.argv.slice(2).filter((a) => a !== '--json'));
    if (!range) {
        process.stderr.write('uso: node scripts/probe/antiban-coverage.cjs <sha-base>..HEAD [--json]\n');
        return 2;
    }

    const verdetti = caricaVerdetti();
    // `--diff-filter=d` esclude le CANCELLAZIONI: un file che non esiste più in HEAD non ha un blob da
    // recensire, e pretenderne il verdetto bloccherebbe per sempre chi fa pulizia.
    const cambiati = gitOrFail(['diff', '--name-only', '--diff-filter=d', range])
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);

    const perimetro = cambiati.filter(nelPerimetro).sort();
    const covered = [];
    const uncovered = [];
    const stale = [];
    const notSafe = [];

    for (const file of perimetro) {
        const voce = verdetti.get(file);
        if (!voce) {
            uncovered.push(file);
            continue;
        }
        const blobAttuale = gitOrFail(['rev-parse', `HEAD:${file}`]).trim();
        if (voce.blob_sha !== blobAttuale) {
            stale.push({ file, recensito: voce.blob_sha, attuale: blobAttuale, criterio: voce.criterio ?? null });
            continue;
        }
        if (voce.verdict !== 'SICURO') {
            notSafe.push({ file, verdict: voce.verdict ?? null });
            continue;
        }
        covered.push(file);
    }

    const ok = uncovered.length === 0 && stale.length === 0 && notSafe.length === 0;
    const esito = {
        ok,
        range,
        verdicts_file: path.relative(repoRoot, verdictsPath).replace(/\\/g, '/'),
        changed_total: cambiati.length,
        in_perimeter: perimetro.length,
        covered,
        uncovered,
        stale,
        not_safe: notSafe,
    };

    if (jsonOut) {
        process.stdout.write(`${JSON.stringify(esito, null, 2)}\n`);
        return ok ? 0 : 1;
    }

    process.stdout.write(`Copertura anti-ban (C64) — range ${range}\n`);
    process.stdout.write(
        `  file cambiati: ${cambiati.length} · nel perimetro: ${perimetro.length} · con verdetto valido: ${covered.length}\n`,
    );
    if (uncovered.length > 0) {
        process.stdout.write(`  SENZA VERDETTO (${uncovered.length}):\n`);
        for (const f of uncovered) process.stdout.write(`    - ${f}\n`);
    }
    if (stale.length > 0) {
        process.stdout.write(`  VERDETTO SCADUTO, il file è cambiato dopo la review (${stale.length}):\n`);
        for (const s of stale) {
            process.stdout.write(`    - ${s.file}  recensito ${s.recensito.slice(0, 12)} ≠ attuale ${s.attuale.slice(0, 12)}\n`);
        }
    }
    if (notSafe.length > 0) {
        process.stdout.write(`  VERDETTO NON SICURO (${notSafe.length}):\n`);
        for (const n of notSafe) process.stdout.write(`    - ${n.file}  verdict=${n.verdict}\n`);
    }
    process.stdout.write(
        ok
            ? '  OK: ogni file del perimetro ha un verdetto SICURO sul blob attuale\n'
            : '  BLOCCATO: esegui /antiban-review sui file elencati e registra la voce in docs/antiban/verdicts.json\n',
    );
    return ok ? 0 : 1;
}

try {
    process.exit(main());
} catch (errore) {
    process.stderr.write(`[antiban-coverage] sonda non in grado di misurare: ${errore.message}\n`);
    process.exit(2);
}
