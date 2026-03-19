import crypto from 'crypto';
import { MessageValidationResult } from '../types/domain';

export interface MessageValidationContext {
    duplicateCountLast24h: number;
    maxLen?: number;
    /** M11: Se fornito, il semantic checker verifica similarità con messaggi precedenti per questo lead */
    leadId?: number;
}

export function extractUnresolvedPlaceholders(message: string): string[] {
    const matches = message.match(/\{\{[^}]+\}\}|\[[^\]]+\]/g);
    return matches ?? [];
}

export function hashMessage(message: string): string {
    return crypto.createHash('sha256').update(message).digest('hex');
}

export function validateMessageContent(message: string, context: MessageValidationContext): MessageValidationResult {
    const reasons: string[] = [];
    const trimmed = message.trim();
    const maxLen = context.maxLen ?? 550;

    if (!trimmed) {
        reasons.push('Messaggio vuoto.');
    }
    if (trimmed.length > maxLen) {
        reasons.push(`Messaggio troppo lungo (${trimmed.length}/${maxLen}).`);
    }
    const unresolved = extractUnresolvedPlaceholders(trimmed);
    if (unresolved.length > 0) {
        reasons.push(`Placeholder non risolti: ${unresolved.join(', ')}`);
    }
    if (context.duplicateCountLast24h >= 3) {
        reasons.push('Messaggio troppo ripetitivo nelle ultime 24h.');
    }

    return {
        valid: reasons.length === 0,
        reasons,
    };
}

/**
 * M11: Validazione asincrona con semantic check — parafrasi dello stesso concetto vengono rilevate.
 * Hash esatto cattura solo duplicati identici; il semantic check cattura anche riformulazioni.
 * Usa questa funzione al posto di validateMessageContent quando il leadId è disponibile.
 */
export async function validateMessageContentAsync(
    message: string,
    context: MessageValidationContext,
): Promise<MessageValidationResult> {
    const syncResult = validateMessageContent(message, context);
    if (!syncResult.valid) return syncResult;

    if (context.leadId !== undefined && context.leadId !== null) {
        try {
            const { SemanticChecker } = await import('../ai/semanticChecker');
            const tooSimilar = await SemanticChecker.isTooSimilar(message, 0.85, context.leadId);
            if (tooSimilar) {
                return {
                    valid: false,
                    reasons: [...syncResult.reasons, 'Messaggio troppo simile a uno già inviato a questo lead (semantic check).'],
                };
            }
        } catch {
            // Se il semantic checker non è disponibile, prosegui con validazione sincrona
        }
    }

    return syncResult;
}
