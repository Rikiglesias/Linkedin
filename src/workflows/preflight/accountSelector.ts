import { getRuntimeAccountProfiles } from '../../accountManager';
import { askChoice, isInteractiveTTY } from '../../cli/stdinHelper';

/**
 * L1: Se sono configurati più account, mostra menu interattivo.
 * Ritorna l'accountId selezionato, o undefined se single-account.
 */
export async function selectAccount(cliAccountId?: string): Promise<string | undefined> {
    if (cliAccountId) return cliAccountId;

    const accounts = getRuntimeAccountProfiles();
    if (accounts.length <= 1) return undefined;

    if (!isInteractiveTTY()) return undefined;

    console.log('');
    console.log('  L1: SELEZIONE ACCOUNT');
    console.log('');
    console.log('  Account configurati:');
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const proxyLabel = acc.proxy ? `proxy: ${acc.proxy.server}` : 'no proxy';
        const warmupLabel = acc.warmupEnabled ? ' [warmup]' : '';
        console.log(`    ${i + 1}. ${acc.id} (${proxyLabel}${warmupLabel})`);
    }
    console.log('');

    const accountIds = accounts.map((a) => a.id);
    const selected = await askChoice('  Quale account vuoi utilizzare?', accountIds, accountIds[0]);
    console.log(`  -> Account selezionato: ${selected}`);
    return selected;
}
