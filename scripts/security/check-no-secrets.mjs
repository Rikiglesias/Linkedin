#!/usr/bin/env node
// Pre-commit secret scanner
// Esegue: scansiona file staged per pattern di secret reali.
// Exit 1 se trova match non whitelistati. Exit 0 altrimenti.

import { execSync } from 'node:child_process';

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

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getStagedContent(file) {
  try {
    return execSync(`git show :${JSON.stringify(file).slice(1, -1)}`, { encoding: 'utf8', maxBuffer: 50_000_000 });
  } catch {
    return '';
  }
}

function isWhitelisted(match) {
  return WHITELIST.some(re => re.test(match));
}

const staged = getStagedFiles();
const findings = [];

for (const file of staged) {
  if (SKIP_FILES.some(re => re.test(file))) continue;
  const content = getStagedContent(file);
  if (!content) continue;

  for (const { name, re } of SECRET_PATTERNS) {
    const matches = content.match(re);
    if (!matches) continue;
    for (const m of matches) {
      if (isWhitelisted(m)) continue;
      const lineNum = content.slice(0, content.indexOf(m)).split('\n').length;
      const preview = m.length > 30 ? m.slice(0, 12) + '…' + m.slice(-6) : m;
      findings.push({ file, line: lineNum, name, preview });
    }
  }
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

process.exit(0);
