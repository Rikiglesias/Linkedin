import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const domainsPath = path.resolve(rootDir, 'src', 'config', 'domains.ts');
const envPath = path.resolve(rootDir, 'src', 'config', 'env.ts');
const outputPath = path.resolve(rootDir, 'CONFIG_REFERENCE.md');

const domainsSource = fs.readFileSync(domainsPath, 'utf8');
const envSource = fs.readFileSync(envPath, 'utf8');

const sections = [];
const headers = Array.from(domainsSource.matchAll(/export function (build\w+DomainConfig)\([^)]*\):[^\{]*\{/g));
for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    const functionName = header[1];
    const bodyStart = (header.index ?? 0) + header[0].length;
    const bodyEnd = i + 1 < headers.length ? (headers[i + 1].index ?? domainsSource.length) : domainsSource.length;
    const body = domainsSource.slice(bodyStart, bodyEnd);

    const envKeys = new Set();
    const parserRegex = /parse(?:Int|Float|Bool|String|Csv|EventSyncSink)Env\('([A-Z0-9_]+)'/g;
    let parserMatch;
    while ((parserMatch = parserRegex.exec(body)) !== null) {
        envKeys.add(parserMatch[1]);
    }

    const processEnvRegex = /process\.env\.([A-Z0-9_]+)/g;
    let processEnvMatch;
    while ((processEnvMatch = processEnvRegex.exec(body)) !== null) {
        envKeys.add(processEnvMatch[1]);
    }

    sections.push({ name: functionName, keys: Array.from(envKeys).sort() });
}

const accountTemplateKeys = new Set();
const accountRegex = /`ACCOUNT_\$\{slot\}_([A-Z0-9_]+)`/g;
let accountMatch;
while ((accountMatch = accountRegex.exec(envSource)) !== null) {
    accountTemplateKeys.add(accountMatch[1]);
}

const lines = [];
lines.push('# Config Reference (Generated)');
lines.push('');
lines.push('Questo file è generato automaticamente da `scripts/generate-config-docs.mjs` leggendo `src/config/domains.ts` e `src/config/env.ts`.');
lines.push('');
lines.push('## Domain Mapping');
lines.push('');

for (const section of sections) {
    lines.push(`### ${section.name}`);
    if (section.keys.length === 0) {
        lines.push('- Nessuna variabile ambiente rilevata.');
    } else {
        for (const key of section.keys) {
            lines.push(`- \`${key}\``);
        }
    }
    lines.push('');
}

lines.push('## Account Profile Template Keys');
lines.push('');
if (accountTemplateKeys.size === 0) {
    lines.push('- Nessuna variabile account template rilevata.');
} else {
    for (const key of Array.from(accountTemplateKeys).sort()) {
        lines.push(`- \`ACCOUNT_{slot}_${key}\``);
    }
}
lines.push('');

fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Generated ${path.relative(rootDir, outputPath)}`);
