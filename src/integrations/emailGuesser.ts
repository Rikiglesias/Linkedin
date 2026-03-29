/**
 * emailGuesser.ts — Pattern-based business email finder
 *
 * Genera candidati email dal nome + dominio aziendale, poi valida
 * tramite DNS MX e SMTP RCPT TO probe. Zero dipendenze esterne.
 *
 * Catena: genera pattern → verifica MX → detect catch-all → probe SMTP → score
 */

import * as dns from 'node:dns';
import * as net from 'node:net';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface EmailGuessResult {
    email: string;
    pattern: string;
    confidence: number; // 0–100
    mxValid: boolean;
    smtpVerified: boolean;
    catchAll: boolean;
}

interface SmtpProbeResult {
    accepted: boolean;
    code: number;
    message: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const SMTP_TIMEOUT_MS = 5_000;
const SMTP_PORT = 25;
const SMTP_SUBMISSION_PORT = 587;
const EHLO_DOMAIN = 'mail-check.local';

/** Cache MX per dominio — evita query DNS ripetute nella stessa sessione */
const mxCache = new Map<string, string | null>();

/** H29: Cache domini con porta 25 bloccata — evita 40s di timeout inutile per ogni lead dello stesso dominio */
const port25BlockedCache = new Set<string>();

// ─── Pattern Generation ──────────────────────────────────────────────────────

interface EmailPattern {
    id: string;
    build: (first: string, last: string) => string;
    weight: number; // bonus confidence per pattern comuni
}

const PATTERNS: EmailPattern[] = [
    { id: 'first.last', build: (f, l) => `${f}.${l}`, weight: 10 },
    { id: 'flast', build: (f, l) => `${f[0]}${l}`, weight: 8 },
    { id: 'first', build: (f) => f, weight: 5 },
    { id: 'firstl', build: (f, l) => `${f}${l[0]}`, weight: 5 },
    { id: 'last.first', build: (f, l) => `${l}.${f}`, weight: 4 },
    { id: 'first_last', build: (f, l) => `${f}_${l}`, weight: 3 },
    { id: 'first-last', build: (f, l) => `${f}-${l}`, weight: 3 },
    { id: 'last', build: (_f, l) => l, weight: 2 },
];

function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // rimuovi accenti (è→e, ñ→n)
        .replace(/[^a-z0-9]/g, '') // solo alfanumerici
        .trim();
}

function generateCandidates(
    firstName: string,
    lastName: string,
    domain: string,
): Array<{ email: string; pattern: string; weight: number }> {
    const first = sanitizeName(firstName);
    const last = sanitizeName(lastName);
    if (!first || !last) return [];

    return PATTERNS.map((p) => ({
        email: `${p.build(first, last)}@${domain}`,
        pattern: p.id,
        weight: p.weight,
    }));
}

// ─── DNS MX Lookup ───────────────────────────────────────────────────────────

async function resolveMx(domain: string): Promise<string | null> {
    const cached = mxCache.get(domain);
    if (cached !== undefined) return cached;

    try {
        const records = await dns.promises.resolveMx(domain);
        if (!records || records.length === 0) {
            mxCache.set(domain, null);
            return null;
        }
        // Prendi il record con priorità più bassa (= preferito)
        records.sort((a, b) => a.priority - b.priority);
        const mx = records[0]?.exchange;
        if (!mx) return null;
        mxCache.set(domain, mx);
        return mx;
    } catch {
        mxCache.set(domain, null);
        return null;
    }
}

// ─── SMTP Probe ──────────────────────────────────────────────────────────────

function smtpProbe(mxHost: string, emailAddress: string, port: number = SMTP_PORT): Promise<SmtpProbeResult> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let phase: 'greeting' | 'ehlo' | 'mail_from' | 'rcpt_to' | 'done' = 'greeting';
        let buffer = '';
        let settled = false;

        const finish = (result: SmtpProbeResult) => {
            if (settled) return;
            settled = true;
            try {
                socket.write('QUIT\r\n');
                socket.end();
            } catch {
                /* ignore */
            }
            resolve(result);
        };

        const timer = setTimeout(() => {
            finish({ accepted: false, code: 0, message: 'timeout' });
            socket.destroy();
        }, SMTP_TIMEOUT_MS);

        socket.once('error', () => {
            finish({ accepted: false, code: 0, message: 'connection_error' });
        });

        socket.once('close', () => {
            finish({ accepted: false, code: 0, message: 'connection_closed' });
        });

        socket.on('data', (data: Buffer) => {
            buffer += data.toString();
            const lines = buffer.split('\r\n');
            // Processa solo linee complete (terminate con \r\n)
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line) continue;
                const code = parseInt(line.substring(0, 3), 10);

                switch (phase) {
                    case 'greeting':
                        if (code >= 200 && code < 400) {
                            phase = 'ehlo';
                            socket.write(`EHLO ${EHLO_DOMAIN}\r\n`);
                        } else {
                            finish({ accepted: false, code, message: line });
                        }
                        break;

                    case 'ehlo':
                        // EHLO può avere risposte multilinea (250-xxx), aspetta la finale (250 xxx)
                        if (line.charAt(3) === ' ' && code >= 200 && code < 400) {
                            phase = 'mail_from';
                            socket.write('MAIL FROM:<>\r\n');
                        } else if (code >= 400) {
                            finish({ accepted: false, code, message: line });
                        }
                        break;

                    case 'mail_from':
                        if (code >= 200 && code < 400) {
                            phase = 'rcpt_to';
                            socket.write(`RCPT TO:<${emailAddress}>\r\n`);
                        } else {
                            finish({ accepted: false, code, message: line });
                        }
                        break;

                    case 'rcpt_to':
                        phase = 'done';
                        clearTimeout(timer);
                        if (code === 250) {
                            finish({ accepted: true, code, message: line });
                        } else {
                            finish({ accepted: false, code, message: line });
                        }
                        break;
                }
            }
        });

        socket.connect(port, mxHost);
    });
}

/**
 * H29: SMTP probe con fallback porta 587 e cache "port blocked".
 * Se porta 25 è bloccata (timeout/connection_error), prova 587 (submission).
 * Caching: se porta 25 è già nota come bloccata per questo host, salta direttamente a 587.
 */
async function smtpProbeWithFallback(mxHost: string, emailAddress: string): Promise<SmtpProbeResult> {
    // Se porta 25 è già nota come bloccata per questo host, prova solo 587
    if (port25BlockedCache.has(mxHost)) {
        return smtpProbe(mxHost, emailAddress, SMTP_SUBMISSION_PORT);
    }

    const result25 = await smtpProbe(mxHost, emailAddress, SMTP_PORT);
    if (
        result25.accepted ||
        (result25.code > 0 && result25.message !== 'timeout' && result25.message !== 'connection_error')
    ) {
        return result25; // Porta 25 funziona (risposta reale, anche se reject)
    }

    // Porta 25 bloccata — cache e prova 587
    if (result25.message === 'timeout' || result25.message === 'connection_error') {
        port25BlockedCache.add(mxHost);
        return smtpProbe(mxHost, emailAddress, SMTP_SUBMISSION_PORT);
    }

    return result25;
}

// ─── Catch-All Detection ─────────────────────────────────────────────────────

async function isCatchAll(mxHost: string, domain: string): Promise<boolean> {
    // Probe con indirizzo impossibile — se il server accetta, è catch-all
    const fakeEmail = `zzz-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${domain}`;
    const result = await smtpProbeWithFallback(mxHost, fakeEmail);
    return result.accepted;
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Indovina l'email aziendale dato nome, cognome e dominio.
 * Ritorna il miglior candidato con confidence score, o null se nessuno valido.
 */
export async function guessBusinessEmail(
    firstName: string,
    lastName: string,
    domain: string,
): Promise<EmailGuessResult | null> {
    if (!firstName || !lastName || !domain) return null;

    const candidates = generateCandidates(firstName, lastName, domain);
    if (candidates.length === 0) return null;

    // Step 1: MX check
    const mxHost = await resolveMx(domain);
    if (!mxHost) return null; // dominio non accetta email

    // Step 2: Catch-all detection
    let catchAll = false;
    try {
        catchAll = await isCatchAll(mxHost, domain);
    } catch {
        // Se fallisce, assumiamo non catch-all e proviamo comunque
    }

    // Step 3: SMTP probe per ogni candidato (in ordine di peso)
    for (const candidate of candidates) {
        try {
            const probe = await smtpProbeWithFallback(mxHost, candidate.email);

            if (probe.accepted) {
                let confidence = 20; // MX valido
                confidence += candidate.weight; // bonus pattern

                if (catchAll) {
                    // Server accetta tutto → non possiamo fidarci del 250
                    confidence = Math.min(confidence, 40);
                } else {
                    confidence += 70; // SMTP confermato
                }

                return {
                    email: candidate.email,
                    pattern: candidate.pattern,
                    confidence: Math.min(confidence, 100),
                    mxValid: true,
                    smtpVerified: !catchAll,
                    catchAll,
                };
            }
        } catch {
            // Probe fallita per questo candidato, continua col prossimo
            continue;
        }
    }

    // Nessun candidato confermato via SMTP — NON indovinare, ritorna null
    return null;
}
