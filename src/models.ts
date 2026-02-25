import {
    addLead as addLeadRepository,
    getDailyStat,
    countLeadsByStatuses,
    countWeeklyInvites as countWeeklyInvitesRepository,
    getLeadsByStatus,
    incrementDailyStat,
    setLeadStatus,
} from './core/repositories';
import { LeadRecord, LeadStatus } from './types/domain';

export interface Lead extends LeadRecord { }

export async function addLead(lead: Partial<Lead>): Promise<void> {
    await addLeadRepository({
        accountName: lead.account_name ?? '',
        firstName: lead.first_name ?? '',
        lastName: lead.last_name ?? '',
        jobTitle: lead.job_title ?? '',
        website: lead.website ?? '',
        linkedinUrl: lead.linkedin_url ?? '',
        listName: lead.list_name ?? 'default',
    });
}

export async function getPendingLeads(limit: number): Promise<Lead[]> {
    return getLeadsByStatus('READY_INVITE', limit);
}

export async function getInvitedLeads(): Promise<Lead[]> {
    return getLeadsByStatus('INVITED', 1000);
}

export async function getAcceptedLeads(limit: number): Promise<Lead[]> {
    return getLeadsByStatus('READY_MESSAGE', limit);
}

export async function updateLeadStatus(id: number, status: LeadStatus): Promise<void> {
    await setLeadStatus(id, status);
}

export async function countDailyInvites(dateString: string): Promise<number> {
    return getDailyStat(dateString, 'invites_sent');
}

export async function countWeeklyInvites(weekStartDate: string): Promise<number> {
    return countWeeklyInvitesRepository(weekStartDate);
}

export async function incrementDailyInvites(dateString: string): Promise<void> {
    await incrementDailyStat(dateString, 'invites_sent');
}

export async function countReadyToInvite(): Promise<number> {
    return countLeadsByStatuses(['READY_INVITE']);
}
