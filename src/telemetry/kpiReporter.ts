import { getGlobalKPIData, getRiskInputs } from '../core/repositories';
import { evaluateRisk } from '../risk/riskEngine';
import { getLocalDateString, config } from '../config';

export async function printDashboard(): Promise<void> {
    const kpi = await getGlobalKPIData();
    const localDate = getLocalDateString();
    const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
    const risk = await evaluateRisk(riskInputs);

    const invited = kpi.statusCounts['INVITED'] || 0;
    const accepted = kpi.statusCounts['ACCEPTED'] || 0;
    const readyMessage = kpi.statusCounts['READY_MESSAGE'] || 0;
    const messaged = kpi.statusCounts['MESSAGED'] || 0;
    const replied = kpi.statusCounts['REPLIED'] || 0;
    const pendingHygiene = kpi.statusCounts['WITHDRAWN'] || 0;

    const totalAccepted = accepted + readyMessage + messaged + replied;
    const totalMessaged = messaged + replied;

    const inviteToAcceptRate = invited + totalAccepted > 0
        ? ((totalAccepted / (invited + totalAccepted)) * 100).toFixed(1) + '%'
        : '0.0%';

    const acceptToReplyRate = totalAccepted > 0
        ? ((replied / totalAccepted) * 100).toFixed(1) + '%'
        : '0.0%';

    console.log('\n======================================================');
    console.log('                 📊 DASHBOARD KPIs 📊                 ');
    console.log('======================================================\n');

    console.log('--- 1. FUNNEL & CONVERSION (Total Database) ---');
    console.log(`  Total Leads:       ${kpi.totalLeads}`);
    console.log(`  Invited (Pending): ${invited}`);
    console.log(`  Total Accepted:    ${totalAccepted}  --> (Acceptance Rate: ${inviteToAcceptRate})`);
    console.log(`  Total Messaged:    ${totalMessaged}`);
    console.log(`  Total Replied:     ${replied}  --> (Reply Rate from Accepted: ${acceptToReplyRate})`);
    console.log(`  Withdrawn:         ${pendingHygiene}`);
    console.log('');

    console.log('--- 2. ACTIVE SYSTEM STATUS ---');
    console.log(`  Active Campaigns:  ${kpi.activeCampaigns}`);
    console.log(`  Acceptances (7d):  ${kpi.totalAcceptances7d}`);
    console.log('');

    console.log('--- 3. RISK ENGINE SNAPSHOT ---');
    console.log(`  Global Action:     ${risk.action}`);
    console.log(`  Risk Score:        ${risk.score.toFixed(1)}`);
    console.log('======================================================\n');
}
