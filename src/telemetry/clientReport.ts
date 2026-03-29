/**
 * A15: Client-facing report leggibile — il cliente (CEO, non-tecnico) capisce
 * cosa sta succedendo senza decifrare JSON o metriche raw.
 *
 * Genera un report settimanale con:
 * - Riepilogo attività (inviti, accettati, messaggi, risposte)
 * - Benchmark ("il tuo acceptance rate è sopra la media")
 * - Suggerimenti actionable ("ritira inviti vecchi per abbassare pending ratio")
 * - Timeline giornaliera semplificata
 */

export interface ClientReportInput {
    weeklyInvitesSent: number;
    weeklyAcceptances: number;
    weeklyMessagesSent: number;
    weeklyReplies: number;
    weeklyFollowUpsSent: number;
    pendingRatio: number;
    riskScore: number;
    hotLeadsCount: number;
    expiredInvitesCount: number;
    accountHealth: 'GREEN' | 'YELLOW' | 'RED';
    listBreakdown?: Array<{
        name: string;
        invitesSent: number;
        acceptanceRate: number;
    }>;
}

export interface ClientReport {
    summary: string;
    suggestions: string[];
    benchmarkNotes: string[];
    overallGrade: 'A' | 'B' | 'C' | 'D';
}

const BENCHMARK_ACCEPTANCE_RATE = { low: 15, average: 25, good: 35, excellent: 45 };
const BENCHMARK_RESPONSE_RATE = { low: 10, average: 20, good: 30, excellent: 40 };

export function generateClientReport(input: ClientReportInput): ClientReport {
    const acceptanceRate = input.weeklyInvitesSent > 0 ? (input.weeklyAcceptances / input.weeklyInvitesSent) * 100 : 0;
    const responseRate = input.weeklyMessagesSent > 0 ? (input.weeklyReplies / input.weeklyMessagesSent) * 100 : 0;

    const suggestions: string[] = [];
    const benchmarkNotes: string[] = [];

    // ── Benchmark acceptance rate ──
    if (acceptanceRate >= BENCHMARK_ACCEPTANCE_RATE.excellent) {
        benchmarkNotes.push(`Acceptance rate ${acceptanceRate.toFixed(1)}% — ECCELLENTE (media settore: 25-35%)`);
    } else if (acceptanceRate >= BENCHMARK_ACCEPTANCE_RATE.good) {
        benchmarkNotes.push(`Acceptance rate ${acceptanceRate.toFixed(1)}% — BUONO (sopra la media settore)`);
    } else if (acceptanceRate >= BENCHMARK_ACCEPTANCE_RATE.average) {
        benchmarkNotes.push(`Acceptance rate ${acceptanceRate.toFixed(1)}% — nella media (25-35%)`);
    } else if (acceptanceRate >= BENCHMARK_ACCEPTANCE_RATE.low) {
        benchmarkNotes.push(
            `Acceptance rate ${acceptanceRate.toFixed(1)}% — sotto la media. Suggerimento: migliora il profilo o il targeting.`,
        );
    } else if (input.weeklyInvitesSent > 0) {
        benchmarkNotes.push(
            `Acceptance rate ${acceptanceRate.toFixed(1)}% — basso. Azione: rivedi il targeting dei lead.`,
        );
    }

    // ── Benchmark response rate ──
    if (responseRate >= BENCHMARK_RESPONSE_RATE.good) {
        benchmarkNotes.push(`Response rate ${responseRate.toFixed(1)}% — BUONO`);
    } else if (responseRate >= BENCHMARK_RESPONSE_RATE.average) {
        benchmarkNotes.push(`Response rate ${responseRate.toFixed(1)}% — nella media`);
    } else if (input.weeklyMessagesSent > 0) {
        benchmarkNotes.push(
            `Response rate ${responseRate.toFixed(1)}% — sotto la media. Suggerimento: personalizza i messaggi.`,
        );
    }

    // ── Suggerimenti actionable ──
    if (input.pendingRatio > 0.55) {
        suggestions.push(
            `Pending ratio alto (${(input.pendingRatio * 100).toFixed(0)}%) — ritira gli inviti vecchi per migliorare.`,
        );
    }
    if (input.expiredInvitesCount > 10) {
        suggestions.push(`${input.expiredInvitesCount} inviti scaduti (>21 giorni) — il ritiro automatico li pulisce.`);
    }
    if (input.hotLeadsCount > 0) {
        suggestions.push(
            `${input.hotLeadsCount} lead caldi questa settimana — rispondi entro 24h per massimizzare la conversione.`,
        );
    }
    if (input.riskScore > 50) {
        suggestions.push('Risk score alto — il sistema sta automaticamente rallentando per proteggere gli account.');
    }
    if (input.accountHealth === 'RED') {
        suggestions.push('Account in stato critico — verifica manualmente LinkedIn per eventuali restrizioni.');
    }
    if (input.weeklyInvitesSent === 0 && input.weeklyMessagesSent === 0) {
        suggestions.push('Nessuna attività questa settimana — verifica che il bot sia in esecuzione.');
    }

    // ── Lista performance ──
    if (input.listBreakdown && input.listBreakdown.length > 1) {
        const sorted = [...input.listBreakdown].sort((a, b) => b.acceptanceRate - a.acceptanceRate);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        if (best && worst && best.acceptanceRate > worst.acceptanceRate * 2) {
            suggestions.push(
                `La lista "${best.name}" performa 2x meglio di "${worst.name}" — concentra il budget sulla migliore.`,
            );
        }
    }

    // ── Grade complessivo ──
    let grade: ClientReport['overallGrade'] = 'B';
    if (
        acceptanceRate >= BENCHMARK_ACCEPTANCE_RATE.good &&
        responseRate >= BENCHMARK_RESPONSE_RATE.average &&
        input.riskScore < 30
    ) {
        grade = 'A';
    } else if (acceptanceRate >= BENCHMARK_ACCEPTANCE_RATE.average && input.riskScore < 50) {
        grade = 'B';
    } else if (acceptanceRate >= BENCHMARK_ACCEPTANCE_RATE.low) {
        grade = 'C';
    } else {
        grade = 'D';
    }

    // ── Summary leggibile ──
    const summary = [
        `📊 Report Settimanale — Voto: ${grade}`,
        '',
        `Inviti inviati: ${input.weeklyInvitesSent}`,
        `Accettati: ${input.weeklyAcceptances} (${acceptanceRate.toFixed(1)}%)`,
        `Messaggi inviati: ${input.weeklyMessagesSent}`,
        `Risposte ricevute: ${input.weeklyReplies} (${responseRate.toFixed(1)}%)`,
        `Follow-up inviati: ${input.weeklyFollowUpsSent}`,
        '',
        `Lead caldi: ${input.hotLeadsCount}`,
        `Salute account: ${input.accountHealth}`,
        `Risk score: ${input.riskScore}/100`,
    ].join('\n');

    return { summary, suggestions, benchmarkNotes, overallGrade: grade };
}

/**
 * Formatta il report completo come testo per Telegram/console.
 */
export function formatClientReportText(report: ClientReport): string {
    const parts = [report.summary];

    if (report.benchmarkNotes.length > 0) {
        parts.push('\n📈 Benchmark:');
        for (const note of report.benchmarkNotes) {
            parts.push(`  • ${note}`);
        }
    }

    if (report.suggestions.length > 0) {
        parts.push('\n💡 Suggerimenti:');
        for (const s of report.suggestions) {
            parts.push(`  • ${s}`);
        }
    }

    if (report.suggestions.length === 0 && report.overallGrade === 'A') {
        parts.push('\n✅ Tutto procede bene — nessuna azione richiesta.');
    }

    return parts.join('\n');
}
