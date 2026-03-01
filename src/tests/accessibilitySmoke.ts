import assert from 'assert';
import fs from 'fs';
import path from 'path';

function hasPattern(content: string, pattern: RegExp): boolean {
    return pattern.test(content);
}

async function run(): Promise<void> {
    const htmlPath = path.resolve(process.cwd(), 'public', 'index.html');
    assert.equal(fs.existsSync(htmlPath), true, 'index.html non trovato in public/');

    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.equal(hasPattern(html, /<main\b/i), true, 'Main landmark mancante');
    assert.equal(hasPattern(html, /<header\b/i), true, 'Header landmark mancante');
    assert.equal(hasPattern(html, /<footer\b/i), true, 'Footer landmark mancante');
    assert.equal(hasPattern(html, /<dialog\b/i), true, 'Dialog per pause flow mancante');

    assert.equal(hasPattern(html, /aria-live="polite"/i), true, 'aria-live=polite mancante');
    assert.equal(hasPattern(html, /onclick\s*=/i), false, 'Inline onclick non consentito');

    const buttonWithoutType = html.match(/<button(?![^>]*\btype=)[^>]*>/gi) ?? [];
    assert.equal(buttonWithoutType.length, 0, `Trovati ${buttonWithoutType.length} button senza attributo type`);

    console.log('Accessibility smoke passed.');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
