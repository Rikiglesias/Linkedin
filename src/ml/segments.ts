export type LeadSegment = 'c_level' | 'founder' | 'director' | 'manager' | 'individual' | 'unknown';

export function inferLeadSegment(jobTitle: string | null | undefined): LeadSegment {
    const normalized = (jobTitle ?? '').toLowerCase().trim();
    if (!normalized) return 'unknown';

    if (/\b(ceo|cto|coo|cfo|chief|president)\b/.test(normalized)) return 'c_level';
    if (/\b(founder|co-founder|cofounder|owner)\b/.test(normalized)) return 'founder';
    if (/\b(director|head of|vp|vice president)\b/.test(normalized)) return 'director';
    if (/\b(manager|lead|responsabile)\b/.test(normalized)) return 'manager';
    return 'individual';
}

