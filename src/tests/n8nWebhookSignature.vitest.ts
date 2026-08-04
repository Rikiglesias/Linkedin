/**
 * Verifica della firma sul webhook n8n che riceve gli eventi del bot.
 *
 * Il codice sotto test è quello VERO, estratto dal JSON del workflow ed eseguito: se qualcuno
 * modifica il nodo "Verify + Normalize" senza aggiornare qui, il test se ne accorge.
 *
 * Il difetto che copre: il segreto veniva letto con `|| ''` e la verifica era dentro
 * `if (secret) { … }`. Senza segreto configurato — che è esattamente il caso reale, perché
 * WEBHOOK_SYNC_SECRET non veniva passato al container n8n — la firma non veniva controllata
 * affatto e il webhook accettava qualunque payload.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface N8nNode {
    name: string;
    parameters?: { jsCode?: string };
}

const WORKFLOW = path.resolve(__dirname, '../../n8n/workflow_bot_events.json');

function verifyNodeCode(): string {
    const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8')) as { nodes: N8nNode[] };
    const node = workflow.nodes.find((n) => n.name === 'Verify + Normalize');
    const code = node?.parameters?.jsCode;
    if (!code) throw new Error('nodo "Verify + Normalize" senza codice: il workflow è cambiato');
    return code;
}

/** Esegue il nodo con l'ambiente che n8n gli fornisce. */
function runNode(items: unknown[], env: Record<string, string>): unknown[] {
    const fn = new Function('items', '$env', 'require', 'Buffer', verifyNodeCode());
    return fn(items, env, require, Buffer) as unknown[];
}

const SECRET = 'segreto-di-prova-non-reale';

function makeItem(body: Record<string, unknown>, signature?: string) {
    const rawBody = JSON.stringify(body);
    return {
        json: {
            body,
            rawBody,
            headers: signature ? { 'x-signature-sha256': signature } : {},
        },
    };
}

function sign(body: Record<string, unknown>, secret: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(JSON.stringify(body), 'utf8').digest('hex');
}

describe('webhook n8n — un evento non firmato non deve entrare', () => {
    const body = { topic: 'lead.invited', payload: { leadId: 7 } };

    it('accetta un evento con firma valida', () => {
        const out = runNode([makeItem(body, sign(body, SECRET))], { WEBHOOK_SYNC_SECRET: SECRET });

        expect(out).toHaveLength(1);
        expect((out[0] as { json: { topic: string } }).json.topic).toBe('lead.invited');
    });

    it('rifiuta un evento con firma sbagliata', () => {
        const wrong = sign(body, 'un-altro-segreto');

        expect(() => runNode([makeItem(body, wrong)], { WEBHOOK_SYNC_SECRET: SECRET })).toThrow(
            /Invalid webhook signature/,
        );
    });

    it('rifiuta un evento senza alcuna firma', () => {
        expect(() => runNode([makeItem(body)], { WEBHOOK_SYNC_SECRET: SECRET })).toThrow(/Invalid webhook signature/);
    });

    it('rifiuta un payload manomesso dopo la firma', () => {
        const signature = sign(body, SECRET);
        const tampered = { topic: 'lead.invited', payload: { leadId: 999 } };

        expect(() => runNode([makeItem(tampered, signature)], { WEBHOOK_SYNC_SECRET: SECRET })).toThrow(
            /Invalid webhook signature/,
        );
    });
});

describe('webhook n8n — senza segreto configurato si rifiuta, non si lascia passare tutto', () => {
    const body = { topic: 'lead.invited', payload: { leadId: 7 } };

    it('rifiuta quando WEBHOOK_SYNC_SECRET manca', () => {
        expect(() => runNode([makeItem(body, sign(body, SECRET))], {})).toThrow(/non configurato/);
    });

    it('rifiuta anche un evento non firmato quando il segreto manca', () => {
        expect(() => runNode([makeItem(body)], {})).toThrow(/non configurato/);
    });
});
