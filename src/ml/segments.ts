export type LeadSegment = 'c_level' | 'founder' | 'director' | 'manager' | 'individual' | 'unknown';
export type LeadIndustry = 'tech' | 'finance' | 'healthcare' | 'education' | 'manufacturing' | 'retail' | 'consulting' | 'nonprofit' | 'other' | 'unknown';
export type LeadCompanySize = 'startup' | 'smb' | 'enterprise' | 'unknown';

export function inferLeadSegment(jobTitle: string | null | undefined): LeadSegment {
    const normalized = (jobTitle ?? '').toLowerCase().trim();
    if (!normalized) return 'unknown';

    if (/\b(ceo|cto|coo|cfo|chief|president)\b/.test(normalized)) return 'c_level';
    if (/\b(founder|co-founder|cofounder|owner)\b/.test(normalized)) return 'founder';
    if (/\b(director|head of|vp|vice president)\b/.test(normalized)) return 'director';
    if (/\b(manager|lead|responsabile)\b/.test(normalized)) return 'manager';
    return 'individual';
}

export function inferLeadIndustry(companyName: string | null | undefined, jobTitle: string | null | undefined): LeadIndustry {
    const combined = `${companyName ?? ''} ${jobTitle ?? ''}`.toLowerCase().trim();
    if (!combined) return 'unknown';

    if (/\b(software|saas|tech|digital|cloud|ai|data|cyber|devops|engineering)\b/.test(combined)) return 'tech';
    if (/\b(bank|finance|fintech|insurance|investment|capital|asset|fund)\b/.test(combined)) return 'finance';
    if (/\b(health|medical|pharma|biotech|hospital|clinic|wellness)\b/.test(combined)) return 'healthcare';
    if (/\b(university|school|education|academy|learning|training)\b/.test(combined)) return 'education';
    if (/\b(manufactur|industrial|factory|production|automotive|aerospace)\b/.test(combined)) return 'manufacturing';
    if (/\b(retail|ecommerce|e-commerce|shop|store|fashion|luxury)\b/.test(combined)) return 'retail';
    if (/\b(consult|advisory|strategy|deloitte|mckinsey|accenture|pwc|kpmg|ey\b)\b/.test(combined)) return 'consulting';
    if (/\b(nonprofit|non-profit|ngo|charity|foundation|humanitarian|hunger)\b/.test(combined)) return 'nonprofit';
    return 'other';
}

export function inferCompanySize(employeeCount: number | null | undefined): LeadCompanySize {
    if (employeeCount === null || employeeCount === undefined || employeeCount <= 0) return 'unknown';
    if (employeeCount <= 50) return 'startup';
    if (employeeCount <= 500) return 'smb';
    return 'enterprise';
}
