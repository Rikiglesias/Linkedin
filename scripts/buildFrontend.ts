/**
 * scripts/buildFrontend.ts
 * ─────────────────────────────────────────────────────────────────
 * Bundle tutti i file frontend TypeScript in un singolo bundle.js
 * usando esbuild. Chart.js è incluso nel bundle (no CDN external).
 *
 * Uso:  npx tsx scripts/buildFrontend.ts
 *       oppure: node -e "require('esbuild').buildSync({...})"
 */

import { buildSync } from 'esbuild';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

const result = buildSync({
    entryPoints: [path.join(ROOT, 'src/frontend/main.ts')],
    outfile: path.join(ROOT, 'public/assets/bundle.js'),
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'esm',
    target: ['es2022'],
    platform: 'browser',
    logLevel: 'info',
});

if (result.errors.length > 0) {
    console.error('Build frontend fallita.');
    process.exit(1);
}
