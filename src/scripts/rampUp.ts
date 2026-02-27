import { initDatabase, closeDatabase } from '../db';
import { getRiskInputs, listLeadCampaignConfigs, updateLeadCampaignConfig } from '../core/repositories';
import { evaluateRisk } from '../risk/riskEngine';
import { config, getLocalDateString } from '../config';

const RAMP_UP_SCHEDULE = [
    { day: 1, inviteCap: 5, messageCap: 5 },
    { day: 2, inviteCap: 10, messageCap: 10 },
    { day: 3, inviteCap: 15, messageCap: 15 },
    { day: 4, inviteCap: 20, messageCap: 20 },
    { day: 5, inviteCap: 25, messageCap: 30 },
    { day: 6, inviteCap: 30, messageCap: 40 },
    { day: 7, inviteCap: 40, messageCap: 50 } // Obiettivo finale a regime moderato
];

async function runRampUp(listName: string, targetDay: number | 'auto') {
    try {
        await initDatabase();

        // 1. Check current risk
        const localDate = getLocalDateString();
        const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const evaluation = evaluateRisk(riskInputs);

        console.log(`[Ramp-Up] Valutazione Rischio Attuale: ${evaluation.score}/100 [Azione: ${evaluation.action}]`);

        if (evaluation.action === 'WARN' || evaluation.action === 'STOP') {
            console.error(`[Ramp-Up] ❌ Rischio troppo elevato (${evaluation.action}) per scalare i limiti. Rimandare ad andamento normalizzato.`);
            process.exit(1);
        }

        // 2. Resolve the target lists
        const configs = await listLeadCampaignConfigs();
        const targetConfigs = listName === 'all'
            ? configs
            : configs.filter(c => c.name.toLowerCase() === listName.toLowerCase());

        if (targetConfigs.length === 0) {
            console.error(`[Ramp-Up] ❌ Nessuna configurazione trovata per la lista: ${listName}`);
            process.exit(1);
        }

        // 3. Apply the ramp up based on day
        let schedule;
        if (targetDay === 'auto') {
            // Find the lowest current invite cap to determine the starting point safely
            const minCurrentCap = Math.min(...targetConfigs.map(c => c.dailyInviteCap ?? 0));
            // Find the first schedule step that is higher than the current min cap
            schedule = RAMP_UP_SCHEDULE.find(s => s.inviteCap > minCurrentCap) || RAMP_UP_SCHEDULE[RAMP_UP_SCHEDULE.length - 1];
            console.log(`[Ramp-Up] Auto-resolve: limite attuale minimo = ${minCurrentCap}. Passiamo al Giorno ${schedule.day}.`);
        } else {
            schedule = RAMP_UP_SCHEDULE.find(s => s.day === targetDay) || RAMP_UP_SCHEDULE[RAMP_UP_SCHEDULE.length - 1];
        }

        console.log(`[Ramp-Up] Applicazione parametri del Giorno ${schedule.day}`);
        console.log(` -> Nuovi Limiti: ${schedule.inviteCap} Inviti / ${schedule.messageCap} Messaggi`);

        for (const cfg of targetConfigs) {
            console.log(` - Aggiornamento lista: ${cfg.name}`);
            await updateLeadCampaignConfig(cfg.name, {
                dailyInviteCap: schedule.inviteCap,
                dailyMessageCap: schedule.messageCap,
                isActive: true
            });
        }

        console.log(`[Ramp-Up] ✅ Limiti aggiornati con successo.`);

    } catch (err) {
        console.error('[Ramp-Up] Errore:', err);
        process.exitCode = 1;
    } finally {
        await closeDatabase();
    }
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
    console.log(`
Uso: ts-node src/scripts/rampUp.ts <list-name|all> <day-number>

Esempio:
  ts-node src/scripts/rampUp.ts "My List" 3
  ts-node src/scripts/rampUp.ts all 1
    `);
    process.exit(0);
}

const listTarget = args[0];
const dayTarget = parseInt(args[1], 10) || 1;

runRampUp(listTarget, dayTarget).catch(console.error);
