#!/usr/bin/env tsx
/**
 * auditRunner.ts — esegue una cascata di audit raccogliendo TUTTI gli esiti, invece di
 * `&&` che aborta al primo fallimento (finding 6-2: un singolo soft state-drift —
 * handoff/obsidian/memory — abortiva l'80% dell'analisi: build/madge/security/skills
 * non giravano mai). Separa HARD (codice/struttura/sicurezza = bloccante) da SOFT
 * (state-drift = informativo, non bloccante, come miss-metrics).
 *
 * Uso: tsx src/scripts/auditRunner.ts <daily|weekly|biweekly|monthly|quarterly>
 * Exit: 1 se almeno un HARD fallisce; 0 se gli HARD passano (i SOFT-fail sono WARN informativi).
 *
 * Sicurezza: nessuna shell (shell:false) e args separati -> nessuna command injection;
 * i comandi sono comunque interamente hardcoded (nessun input utente).
 */
import { spawnSync } from 'node:child_process';

interface Step {
  name: string;
  file: string;
  args: string[];
  hard: boolean;
}

const isWin = process.platform === 'win32';
const NPM = 'npm';
const NPX = 'npx';

// SOFT = state-drift informativo (NON deve bloccare la cascata). HARD = integrita reale.
const a = (name: string, hard: boolean): Step => ({ name, file: NPM, args: ['run', `audit:${name}`], hard });

const WEEKLY: Step[] = [
  // (adk-split T11.5b) continuation-completeness rimosso: scope ADK di aiReasoningHardening,
  // in migrazione verso AI-Control-Plane. Gli audit ADK escono dai cascade del repo applicativo.
  a('violations', false),
  a('docs-size', false),
  a('output-styles', true),
  a('mcp-config', true),
  a('json-schemas', true),
  a('rules-coverage', true),
  a('auto-track', false),
];

const MONTHLY: Step[] = [
  a('ai-control-plane', true),
  a('rule-enforcement', false),
  a('ledger', false),
];

const MADGE: Step = { name: 'madge-circular', file: NPX, args: ['madge', '--circular', 'src/'], hard: true };
const BUILD: Step = { name: 'build', file: NPM, args: ['run', 'build'], hard: true };
const SECURITY: Step = { name: 'security-scan', file: NPM, args: ['run', 'security:scan'], hard: true };
const CONTA: Step = { name: 'conta-problemi', file: NPM, args: ['run', 'conta-problemi'], hard: true };

const BUNDLES: Record<string, Step[]> = {
  daily: [SECURITY, CONTA],
  weekly: WEEKLY,
  biweekly: [...WEEKLY, MADGE, BUILD],
  monthly: MONTHLY,
  quarterly: [...MONTHLY, SECURITY, BUILD, MADGE],
};

const bundle = process.argv[2];
const steps = BUNDLES[bundle];
if (!steps) {
  console.error(`auditRunner: bundle sconosciuto "${bundle ?? ''}". Usa uno di: ${Object.keys(BUNDLES).join(' | ')}`);
  process.exit(2);
}

console.log(`\n=== audit:${bundle} (runner: esegue TUTTI gli step; un soft-fail NON aborta la cascata) ===\n`);

let hardFail = 0;
let softFail = 0;
let passed = 0;
const rows: string[] = [];

for (const step of steps) {
  const start = Date.now();
  // Su Windows npm/npx sono .cmd: Node (post CVE-2024-27980) non li esegue con shell:false.
  // Li invochiamo via cmd.exe /c (eseguibile esplicito, NON shell:true) con args hardcoded -> nessuna injection.
  const r = isWin
    ? spawnSync('cmd.exe', ['/c', step.file, ...step.args], { stdio: 'inherit', shell: false })
    : spawnSync(step.file, step.args, { stdio: 'inherit', shell: false });
  const ms = Date.now() - start;
  const exit = typeof r.status === 'number' ? r.status : 1; // null (segnale/errore spawn) = fallimento
  if (exit === 0) {
    passed++;
    rows.push(`  PASS   ${step.name} (${ms} ms)`);
  } else if (step.hard) {
    hardFail++;
    rows.push(`  FAIL!  ${step.name} [HARD] (exit ${exit})`);
  } else {
    softFail++;
    rows.push(`  WARN   ${step.name} [soft state-drift] (exit ${exit})`);
  }
}

console.log(`\n--- audit:${bundle} summary ---`);
for (const row of rows) console.log(row);
console.log(`\n  ${passed} pass | ${hardFail} hard-fail | ${softFail} soft-warn  (su ${steps.length} step)`);

if (hardFail > 0) {
  console.log(`  ESITO: FAIL — ${hardFail} hard-fail bloccanti (codice/struttura/sicurezza).\n`);
  process.exit(1);
}
console.log(`  ESITO: OK — tutti gli HARD verdi. I soft-warn sono state-drift informativi (non bloccano).\n`);
process.exit(0);
