import { describe, it, expect } from 'vitest';
import { bridgeLeadStatus, bridgeAccountHealth } from '../cloud/cloudBridge';

// Estratto da `appContextAndCloudBridge.vitest.ts` quando `core/appContext.ts` è stato rimosso
// (C6: astrazione DI mai adottata). Questi casi coprono codice VIVO e restano invariati; il nome
// del file ora dice cosa verifica davvero.
describe('cloudBridge — fire-and-forget', () => {
    it('bridgeLeadStatus non lancia (fire-and-forget)', () => {
        // Senza Supabase configurato, dovrebbe ritornare silenziosamente
        expect(() => bridgeLeadStatus('https://www.linkedin.com/in/test', 'INVITED')).not.toThrow();
    });

    it('bridgeAccountHealth non lancia', () => {
        expect(() => bridgeAccountHealth('test-account', 'GREEN')).not.toThrow();
    });
});
