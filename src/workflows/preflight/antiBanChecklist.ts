import { getRuntimeAccountProfiles } from '../../accountManager';
import { config } from '../../config';
import { askConfirmation } from '../../cli/stdinHelper';
import { getRuntimeFlag } from '../../core/repositories';
import type { PreflightConfigStatus, PreflightDbStats } from '../types';

export async function runAntiBanChecklist(
    workflowName: string,
    dbStats?: PreflightDbStats,
    _cfgStatus?: PreflightConfigStatus,
): Promise<boolean> {
    const isOutreach = workflowName === 'send-invites' || workflowName === 'send-messages';
    const minHours = isOutreach ? 2 : 1;

    const accounts = getRuntimeAccountProfiles();
    let recentSessionHours: number | null = null;
    for (const acc of accounts) {
        const lastTs = await getRuntimeFlag(`browser_session_started_at:${acc.id}`).catch(() => null);
        if (lastTs) {
            const parsedMs = Date.parse(lastTs);
            if (Number.isFinite(parsedMs)) {
                const h = (Date.now() - parsedMs) / 3600000;
                if (recentSessionHours === null || h < recentSessionHours) recentSessionHours = h;
            }
        }
    }

    const pendingCount = dbStats?.byStatus['INVITED'] ?? 0;
    const totalInvited = dbStats ? Object.values(dbStats.byStatus).reduce((s, v) => s + v, 0) : 0;
    const pendingRatio = totalInvited > 0 ? pendingCount / totalInvited : 0;
    const readyInvite = dbStats?.byStatus['READY_INVITE'] ?? 0;
    const readyMessage = (dbStats?.byStatus['ACCEPTED'] ?? 0) + (dbStats?.byStatus['READY_MESSAGE'] ?? 0);
    const lastSyncDaysAgo = dbStats?.lastSyncAt
        ? Math.floor((Date.now() - new Date(dbStats.lastSyncAt).getTime()) / 86400000)
        : null;
    const leadsWithoutEmail = dbStats?.withoutEmail ?? 0;
    const totalLeads = dbStats?.totalLeads ?? 0;
    const isFirstSessionToday = recentSessionHours === null || recentSessionHours > 12;

    console.log('');
    console.log('  L6: CHECKLIST ANTI-BAN');
    console.log('');

    const tabOk = await askConfirmation('    Tab LinkedIn chiusi e browser pronto? [Y/n] ');
    if (!tabOk) {
        console.log('      -> Chiudi TUTTI i tab LinkedIn. Per fermare: Ctrl+C (mai chiudere la finestra).');
        console.log('');
        console.log('  [!!!] Risolvi prima di procedere.');
        return false;
    }

    if (recentSessionHours !== null && recentSessionHours < minHours) {
        const minLeft = Math.ceil((minHours - recentSessionHours) * 60);
        const proceedAnyway = await askConfirmation(
            `    [!] Ultima sessione ${recentSessionHours.toFixed(1)}h fa (consigliato ${minHours}h). Procedere comunque? [y/N] `,
            false,
        );
        if (!proceedAnyway) {
            console.log(`      -> Attendi ~${minLeft} minuti prima della prossima sessione.`);
            return false;
        }
    }

    // CL6 (collaudo): il pending ratio e' una metrica anti-ban primaria (browser-antiban #4:
    // "pending ratio sotto controllo, mai bypass"). Prima qui c'era SOLO un warning stampato e il
    // flusso proseguiva: inviare nuovi inviti con pending gia' oltre la soglia di STOP lo peggiora
    // -> rischio flag/ban. Ora, oltre config.pendingRatioStop, chiediamo conferma esplicita
    // (default NO) e abortiamo se l'utente non forza. Sotto la soglia di stop ma sopra quella di
    // warn resta il warning informativo. Soglie canoniche da config (no magic number hardcoded).
    if (isOutreach && pendingCount > 10 && pendingRatio >= config.pendingRatioStop) {
        console.log(
            `    [!!!] Pending ratio: ${Math.round(pendingRatio * 100)}% (${pendingCount} inviti in attesa) — oltre la soglia di STOP (${Math.round(config.pendingRatioStop * 100)}%).`,
        );
        console.log('        LinkedIn flagga gli account con pending ratio alto: inviare ora peggiora il rischio.');
        console.log('        Consiglio: ritira gli inviti vecchi con "bot.ps1 run check" prima di inviarne di nuovi.');
        const proceedAnyway = await askConfirmation(
            '    [!] Inviare COMUNQUE nonostante il pending ratio oltre soglia? [y/N] ',
            false,
        );
        if (!proceedAnyway) {
            console.log('      -> Sessione interrotta. Lancia "bot.ps1 run check" per abbassare il pending ratio.');
            return false;
        }
    } else if (isOutreach && pendingCount > 10 && pendingRatio > config.pendingRatioWarn) {
        console.log(`    [!] Pending ratio: ${Math.round(pendingRatio * 100)}% (${pendingCount} inviti in attesa)`);
        console.log(
            `        Soglia di stop a ${Math.round(config.pendingRatioStop * 100)}%. Consiglio: ritira inviti vecchi con "bot.ps1 run check" prima di inviare nuovi.`,
        );
        console.log('');
    }

    if (lastSyncDaysAgo !== null && lastSyncDaysAgo > 7) {
        console.log(`    [!] Ultimo sync: ${lastSyncDaysAgo} giorni fa — i dati potrebbero essere obsoleti.`);
        console.log('        Consiglio: lancia "bot.ps1 sync-list" per aggiornare prima di procedere.');
        console.log('');
    }

    if (totalLeads > 10 && leadsWithoutEmail > totalLeads * 0.7) {
        console.log(
            `    [i] ${leadsWithoutEmail}/${totalLeads} lead senza email — l'enrichment migliorera' la personalizzazione.`,
        );
        console.log('');
    }

    if (workflowName === 'send-invites' && readyInvite === 0) {
        console.log('    [!] 0 lead READY_INVITE — non ci sono lead pronti da invitare.');
        console.log('        Lancia prima "bot.ps1 sync-search" o "bot.ps1 sync-list" con enrichment.');
        console.log('');
    }
    if (workflowName === 'send-messages' && readyMessage === 0) {
        console.log('    [!] 0 lead pronti per messaggi — attendi che qualcuno accetti i tuoi inviti.');
        console.log('');
    }

    console.log('  TIPS SESSIONE:');
    console.log('    [i] CAPTCHA: il bot li risolve automaticamente (GPT-5.4 + Ollama fallback)');
    if (isFirstSessionToday) {
        console.log("    [i] Prima sessione oggi: il bot fara' warmup (feed + notifiche) prima di agire");
    }
    console.log(`    [i] Dopo la sessione: aspetta almeno ${minHours}h prima di usare LinkedIn`);
    console.log('');

    return true;
}
