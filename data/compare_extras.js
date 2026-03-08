/**
 * Script di confronto: identifica i record extra su Supabase
 * rispetto alla lista SalesNav attuale nel DB locale.
 *
 * Uso: node data/compare_extras.js
 * (da lanciare DOPO aver ri-scrappato la lista con salesnav-extract-first-search)
 */

const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERRORE: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostati nel .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

function sqliteAll(db, sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function main() {
    // 1. Leggi i record dal DB locale (appena scrappati)
    const db = new sqlite3.Database('./data/linkedin.db', sqlite3.OPEN_READONLY);
    const localRows = await sqliteAll(db, `
        SELECT id, profile_name, company, salesnav_url, name_company_hash, page_number
        FROM salesnav_list_members
        ORDER BY id
    `);
    db.close();

    console.log(`\n=== DB LOCALE: ${localRows.length} record (lista attuale)\n`);

    // 2. Leggi i record da Supabase (89 record precedenti)
    const { data: cloudRows, error } = await supabase
        .from('salesnav_list_members')
        .select('id, profile_name, company, salesnav_url, name_company_hash, page_number')
        .order('id', { ascending: true });

    if (error) {
        console.error('Errore Supabase:', error.message);
        process.exit(1);
    }

    console.log(`=== SUPABASE: ${cloudRows.length} record (scrape precedente)\n`);

    // 3. Crea set di salesnav_url dal DB locale
    const localUrls = new Set(localRows.map((r) => r.salesnav_url).filter(Boolean));
    const localHashes = new Set(localRows.map((r) => r.name_company_hash).filter(Boolean));

    // 4. Trova record su Supabase che NON sono nel DB locale
    const extras = cloudRows.filter((r) => {
        // Match per salesnav_url
        if (r.salesnav_url && localUrls.has(r.salesnav_url)) return false;
        // Fallback: match per name_company_hash
        if (r.name_company_hash && localHashes.has(r.name_company_hash)) return false;
        return true;
    });

    console.log(`=== RECORD EXTRA (su Supabase ma NON nella lista attuale): ${extras.length}\n`);
    extras.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.profile_name} | ${r.company || '(no company)'} | pg ${r.page_number}`);
        console.log(`     SalesNav: ${r.salesnav_url}`);
    });

    // 5. Trova record nel DB locale che NON sono su Supabase (nuovi)
    const cloudUrls = new Set(cloudRows.map((r) => r.salesnav_url).filter(Boolean));
    const newLocal = localRows.filter((r) => r.salesnav_url && !cloudUrls.has(r.salesnav_url));

    if (newLocal.length > 0) {
        console.log(`\n=== NUOVI RECORD (nel DB locale ma NON su Supabase): ${newLocal.length}\n`);
        newLocal.forEach((r, i) => {
            console.log(`  ${i + 1}. ${r.profile_name} | ${r.company || '(no company)'} | pg ${r.page_number}`);
        });
    }

    // 6. Riepilogo
    console.log('\n=== RIEPILOGO ===');
    console.log(`  Lista attuale (DB locale): ${localRows.length}`);
    console.log(`  Scrape precedente (Supabase): ${cloudRows.length}`);
    console.log(`  In comune: ${cloudRows.length - extras.length}`);
    console.log(`  Extra (non piu' nella lista): ${extras.length}`);
    console.log(`  Nuovi (aggiunti alla lista): ${newLocal.length}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
