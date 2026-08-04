#!/usr/bin/env node
// Gate segreti — pre-commit e audit periodico.
//
// Due modalità, scelte da sole:
//   staged  — ci sono file in area di stage (è un commit): scansiona quelli.
//   tracked — l'area di stage è vuota (è l'audit schedulato): scansiona i file versionati su disco.
// Senza la seconda modalità l'audit dichiarava PASS senza aver letto un solo byte.
//
// Exit 1 se trova un segreto non whitelistato OPPURE se non riesce a leggere un file che
// doveva scansionare: da una lettura fallita non si può concludere "nessun segreto".

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const SECRET_PATTERNS = [
  { name: 'OpenAI key',       re: /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}/g },
  { name: 'Anthropic key',    re: /sk-ant-[A-Za-z0-9_-]{40,}/g },
  { name: 'GitHub PAT',       re: /(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})/g },
  { name: 'Google API key',   re: /AIza[A-Za-z0-9_-]{35}/g },
  { name: 'AWS access key',   re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Slack token',      re: /xox[baprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'JWT',              re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { name: 'PEM private key',  re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g },
];

// Match palesemente fake o di test — non bloccare
const WHITELIST = [
  /sk-(?:XXX|TEST|FAKE|123|abc|example|placeholder|your)/i,
  /sk-ant-(?:XXX|TEST|FAKE|123|example)/i,
  /AIza(?:XXX|TEST|FAKE|EXAMPLE)/i,
  /your[-_]?(?:api[-_]?key|token|secret)/i,
];

// File da non scansionare (binari, lock, vendor)
const SKIP_FILES = [
  /^node_modules\//,
  /package-lock\.json$/,
  /\.lock$/,
  /\.(?:exe|dll|so|dylib|png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|7z|woff2?)$/i,
];

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Esegue git SENZA shell: gli argomenti arrivano al processo così come sono.
 * Con execSync + stringa interpolata un nome file che contiene `&` o `;` veniva eseguito
 * come comando — provato dal vivo: `a&copy NUL INJECTED.txt` creava davvero il file.
 */
function git(args, { binary = false } = {}) {
  return execFileSync('git', args, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: MAX_FILE_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function toFileList(out) {
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Elenco dei file da scansionare + la modalità con cui è stato ottenuto. */
function selectFiles() {
  let staged;
  try {
    staged = toFileList(git(['diff', '--cached', '--name-only', '--diff-filter=ACM']));
  } catch {
    console.error('\n❌ GATE SEGRETI NON ESEGUIBILE — git non risponde (siamo dentro un repository?).');
    console.error('   Un controllo che non puo\' girare non e\' un controllo superato.\n');
    process.exit(1);
  }
  if (staged.length > 0) return { files: staged, mode: 'staged' };

  try {
    return { files: toFileList(git(['ls-files'])), mode: 'tracked' };
  } catch {
    console.error('\n❌ GATE SEGRETI NON ESEGUIBILE — impossibile elencare i file versionati.\n');
    process.exit(1);
  }
}

/** Un buffer con byte NUL e' binario: non contiene segreti in forma leggibile. */
function decodeText(buf) {
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

/**
 * Contenuto del file. In modalita' staged si legge la versione IN STAGE (e' quella che verrebbe
 * committata); se git non la restituisce si ripiega sul file su disco.
 * Ritorna null per cio' che non e' testo da scansionare (directory, binari, file gia' rimosso).
 * LANCIA se il file esiste ma non si riesce a leggerlo: il chiamante blocca il commit.
 */
function readContent(file, mode) {
  // Se la lettura dallo stage fallisce (gitlink/submodule, o contenuto oltre maxBuffer) si
  // prova il working tree; il motivo NON viene perso: serve a spiegare l'esito se fallisce
  // anche quello.
  let stageError = null;

  if (mode === 'staged') {
    try {
      return decodeText(git(['show', `:${file}`], { binary: true }));
    } catch (err) {
      stageError = err;
    }
  }

  try {
    const stat = statSync(file);
    if (stat.isDirectory()) return null;
    return decodeText(readFileSync(file));
  } catch (err) {
    // File versionato ma non piu' sul disco: non c'e' contenuto da controllare, non e' un buco.
    // In modalita' staged invece qui ci si arriva solo dopo un errore di lettura: quello blocca.
    if (err?.code === 'ENOENT' && mode === 'tracked') return null;
    const detail = stageError ? ` (dallo stage: ${stageError.message?.split('\n')[0]})` : '';
    throw new Error(`${err.message?.split('\n')[0]}${detail}`);
  }
}

function isWhitelisted(match) {
  return WHITELIST.some((re) => re.test(match));
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

const { files, mode } = selectFiles();
const findings = [];
const unreadable = [];
let scanned = 0;

for (const file of files) {
  if (SKIP_FILES.some((re) => re.test(file))) continue;

  let content;
  try {
    content = readContent(file, mode);
  } catch (err) {
    unreadable.push({ file, reason: err?.message ?? String(err) });
    continue;
  }
  if (content === null) continue;
  scanned++;

  for (const { name, re } of SECRET_PATTERNS) {
    // matchAll da' la posizione REALE di ogni occorrenza: con indexOf, lo stesso segreto
    // ripetuto veniva riportato due volte alla riga della prima.
    for (const m of content.matchAll(re)) {
      const value = m[0];
      if (isWhitelisted(value)) continue;
      const preview = value.length > 30 ? value.slice(0, 12) + '…' + value.slice(-6) : value;
      findings.push({ file, line: lineOf(content, m.index), name, preview });
    }
  }
}

if (unreadable.length > 0) {
  console.error('\n❌ GATE SEGRETI INCOMPLETO — file non leggibili, commit bloccato\n');
  for (const u of unreadable) {
    console.error(`  ${u.file}  →  ${u.reason}`);
  }
  console.error('\nUn file non letto non e\' un file pulito: sistema l\'accesso e riprova.\n');
  process.exit(1);
}

if (findings.length > 0) {
  console.error('\n❌ SECRET DETECTED — commit bloccato\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.name}]  ${f.preview}`);
  }
  console.error('\nAzioni:');
  console.error('  1. Rimuovi il secret dal file e usa una variabile d\'ambiente');
  console.error('  2. Se e\' un fixture di test, aggiungi pattern fake (es. "sk-test-...", "sk-XXX")');
  console.error('  3. Se e\' un falso positivo, modifica scripts/security/check-no-secrets.mjs (WHITELIST)');
  console.error('  4. REVOCA il secret se gia\' esposto altrove\n');
  process.exit(1);
}

console.log(`✅ Nessun secret — ${scanned} file scansionati (modalita' ${mode}).`);
process.exit(0);
