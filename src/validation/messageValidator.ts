import crypto from 'crypto';
import { MessageValidationResult } from '../types/domain';

export interface MessageValidationContext {
    duplicateCountLast24h: number;
    maxLen?: number;
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

