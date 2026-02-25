import fs from 'fs';
import csv from 'csv-parser';
import { addCompanyTarget, addLead } from './core/repositories';
import { isLinkedInUrl, normalizeLinkedInUrl } from './linkedinUrl';

export interface ImportResult {
    inserted: number;
    companyTargetsInserted: number;
    skipped: number;
}

/**
 * Legge un valore da un record CSV provando più possibili nomi di colonna in ordine.
 */
function pickField(row: Record<string, string>, ...keys: string[]): string {
    for (const key of keys) {
        const val = row[key];
        if (val && val.trim()) {
            return val.trim();
        }
    }
    return '';
}

function normalizeWebsite(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.includes('.') && !trimmed.includes(' ')) {
        return `https://${trimmed}`;
    }
    return trimmed;
}

export async function importLeadsFromCSV(filePath: string, listName: string): Promise<ImportResult> {
    const rows: Array<Record<string, string>> = [];

    await new Promise<void>((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row: Record<string, string>) => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    let inserted = 0;
    let companyTargetsInserted = 0;
    let skipped = 0;

    for (const row of rows) {
        // LinkedIn URL — Sales Navigator e formati alternativi
        const lnUrlRaw = pickField(
            row,
            'linkedin_url',
            'LinkedIn URL',
            'linkedinUrl',
            'LinkedIn Profile URL',
            'Profile URL',
            'Linkedin',
            'Person Linkedin Url',
            'Contact LinkedIn URL'
        );

        const linkedinUrl = normalizeLinkedInUrl(lnUrlRaw.trim());

        // Sales Navigator: "First Name" e "Last Name" separati
        const firstName = pickField(row, 'First Name', 'first_name', 'FirstName');
        const lastName = pickField(row, 'Last Name', 'last_name', 'LastName');

        // Nome account / azienda
        const accountName = pickField(
            row,
            'Account Name', 'account_name', 'Company', 'Company Name', 'company_name',
            'companyName', 'Organization'
        );

        // Se non abbiamo accountName esplicito, lo costruiamo da first+last
        const resolvedAccountName = accountName || [firstName, lastName].filter(Boolean).join(' ');

        const jobTitle = pickField(row, 'Title', 'Job Title', 'job_title', 'Position');
        const website = normalizeWebsite(
            pickField(
                row,
                'Website',
                'website',
                'Company Website',
                'Company Domain',
                'domain'
            )
        );

        if (!linkedinUrl || !isLinkedInUrl(linkedinUrl)) {
            const insertedCompanyTarget = await addCompanyTarget({
                listName,
                accountName: resolvedAccountName,
                website,
                sourceFile: filePath,
            });
            if (insertedCompanyTarget) {
                companyTargetsInserted += 1;
            } else {
                skipped += 1;
            }
            continue;
        }

        const isNew = await addLead({
            accountName: resolvedAccountName,
            firstName,
            lastName,
            jobTitle,
            website,
            linkedinUrl,
            listName,
        });

        if (isNew) {
            inserted += 1;
        } else {
            skipped += 1;
        }
    }

    return { inserted, companyTargetsInserted, skipped };
}
