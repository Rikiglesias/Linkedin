/**
 * testEnrichment.ts — Test the enrichment pipeline on existing leads
 * Usage: npx tsx scripts/testEnrichment.ts [--limit N] [--deep]
 */
import { initDatabase, closeDatabase, getDatabase } from '../src/db';
import { enrichLeadAuto, isPersonalEmail } from '../src/integrations/leadEnricher';

async function main() {
    const args = process.argv.slice(2);
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || '3', 10) : 3;
    const deep = args.includes('--deep');

    console.log(`\n=== Enrichment Pipeline Test === limit=${limit}, deep=${deep}\n`);

    await initDatabase();
    const db = await getDatabase();

    // Clear previous enrichment data for clean test
    await db.run('DELETE FROM lead_enrichment_data');

    const leads = await db.query<{
        id: number;
        first_name: string | null;
        last_name: string | null;
        account_name: string | null;
        website: string | null;
        linkedin_url: string | null;
        company_domain: string | null;
        location: string | null;
        email: string | null;
    }>(
        `SELECT id, first_name, last_name, account_name, website, linkedin_url, company_domain, location, email
         FROM leads
         WHERE status IN ('NEW', 'READY_INVITE')
         ORDER BY id
         LIMIT ?`,
        [limit],
    );

    console.log(`Found ${leads.length} leads to enrich\n`);

    let enriched = 0;
    let emailsFound = 0;
    let businessEmailsFound = 0;
    let phonesFound = 0;
    let domainsFound = 0;

    for (const lead of leads) {
        console.log(`--- Lead #${lead.id}: ${lead.first_name} ${lead.last_name} (${lead.account_name || 'no company'}) ---`);

        try {
            const start = Date.now();
            const result = await enrichLeadAuto(lead, { deep });
            const elapsed = Date.now() - start;

            console.log(`  Domain: ${result.companyDomain || '(none)'} [source: ${result.domainSource || 'none'}]`);
            console.log(`  Source: ${result.source}`);
            console.log(`  Email: ${result.email || '(none)'} (confidence: ${result.emailConfidence})${isPersonalEmail(result.email) ? ' [PERSONAL]' : ''}`);
            console.log(`  Business Email: ${result.businessEmail || '(none)'} (confidence: ${result.businessEmailConfidence})`);
            console.log(`  Phone: ${result.phone || '(none)'}`);
            console.log(`  Job Title: ${result.jobTitle || '(none)'}`);
            console.log(`  Company: ${result.companyName || '(none)'}`);
            console.log(`  Industry: ${result.industry || '(none)'}`);
            console.log(`  Seniority: ${result.seniority || '(none)'}`);
            if (result.deepEnrichment) {
                console.log(`  OSINT: ${result.deepEnrichment.dataPoints} data points, confidence ${result.deepEnrichment.overallConfidence}`);
                if (result.deepEnrichment.emails.length > 0) {
                    console.log(`  OSINT emails: ${result.deepEnrichment.emails.map(e => `${e.address} (${e.confidence})`).join(', ')}`);
                }
                if (result.deepEnrichment.phones.length > 0) {
                    console.log(`  OSINT phones: ${result.deepEnrichment.phones.map(p => p.number).join(', ')}`);
                }
            }
            console.log(`  Time: ${elapsed}ms`);

            enriched++;
            if (result.email) emailsFound++;
            if (result.businessEmail) businessEmailsFound++;
            if (result.phone) phonesFound++;
            if (result.companyDomain) domainsFound++;

            // Persist to DB
            await db.run(
                `UPDATE leads SET
                    email = COALESCE(email, ?),
                    phone = COALESCE(phone, ?),
                    company_domain = COALESCE(company_domain, ?),
                    business_email = COALESCE(business_email, ?),
                    business_email_confidence = CASE
                        WHEN business_email IS NOT NULL THEN business_email_confidence
                        WHEN ? IS NOT NULL THEN ?
                        ELSE business_email_confidence
                    END,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    result.email, result.phone, result.companyDomain,
                    result.businessEmail,
                    result.businessEmail, result.businessEmailConfidence,
                    lead.id,
                ],
            );
        } catch (err) {
            console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
        }
        console.log();
    }

    console.log(`\n=== Summary ===`);
    console.log(`Enriched: ${enriched}/${leads.length}`);
    console.log(`Domains found: ${domainsFound}/${leads.length}`);
    console.log(`Emails found: ${emailsFound}/${leads.length}`);
    console.log(`Business emails: ${businessEmailsFound}/${leads.length}`);
    console.log(`Phones found: ${phonesFound}/${leads.length}`);

    await closeDatabase();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
