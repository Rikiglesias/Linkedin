import { runSalesNavigatorListSync } from '../core/salesNavigatorSync';
import { sendTelegramAlert } from '../telemetry/alerts';
import { config } from '../config';

export async function processTelegramImportCommand(accountId: string, args: string): Promise<void> {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
        await sendTelegramAlert(
            `❌ Comando non valido.\nUso: \`/importa <NomeLista> <URL>\``,
            'Importazione Automa',
            'warn',
        );
        return;
    }

    const listName = parts[0];
    const listUrl = parts.slice(1).join(' ');

    await sendTelegramAlert(
        `⏳ Avvio esplorazione liste tramite URL...\nLista: **${listName}**\nAccount: **${accountId}**\n\n_Il robot sta aprendo il browser in background..._`,
        'AI Extraction Iniziata',
        'info',
    );

    try {
        if (listUrl.includes('linkedin.com/sales')) {
            const report = await runSalesNavigatorListSync({
                listName,
                listUrl,
                maxPages: config.salesNavSyncMaxPages || 5, // Fallback safe
                maxLeadsPerList: config.salesNavSyncLimit || 200,
                dryRun: false,
                accountId,
            });

            await sendTelegramAlert(
                `✅ Estrazione Completata!\n\n` +
                    `📊 **Lista:** ${listName}\n` +
                    `🔍 **Nuovi Trovati:** ${report.inserted}\n` +
                    `🔄 **Aggiornati:** ${report.updated}\n` +
                    `⚠️ **Errori:** ${report.errors}\n\n` +
                    `_I contatti sono stati caricati nel DB pronti per le Sequence!_`,
                'Risultato Importazione',
                'info',
            );
        } else {
            // Placeholder: Nel futuro o se implementeremo la fallaback per profili standard / eventi
            await sendTelegramAlert(
                `⚠️ L'URL non sembra essere un Sales Navigator valid. Attualmente l'AI fallback per URL generici su post o search base è in costruzione.`,
                'Supporto Limitato',
                'warn',
            );
        }
    } catch (e) {
        console.error('[TELEGRAM AI IMPORTER] Errore:', e);
        await sendTelegramAlert(
            `❌ Errore critico in fase di scraping!\n\nDettaglio: ${e instanceof Error ? e.message : 'Unknown Error'}`,
            'Scraping Fallito',
            'critical',
        );
    }
}
