import { asJsonObject, readString } from './dom';
import { TimelineEntry, TimelineFilter } from './types';

const MAX_TIMELINE_ENTRIES = 300;

function summarize(type: string, payload: Record<string, unknown>): string {
    if (type === 'run.log') {
        const eventName = readString(payload, 'event') ?? 'run.log';
        const level = readString(payload, 'level') ?? 'INFO';
        return `[${level}] ${eventName}`;
    }

    if (type.startsWith('incident.')) {
        const incidentId = readString(payload, 'incidentId', 'incident_id');
        return incidentId ? `${type} #${incidentId}` : type;
    }

    if (type.startsWith('lead.')) {
        const leadId = readString(payload, 'leadId', 'lead_id');
        const status = readString(payload, 'toStatus', 'to_status', 'status');
        if (leadId && status) {
            return `Lead ${leadId} -> ${status}`;
        }
        if (leadId) {
            return `Lead ${leadId}`;
        }
    }

    return type;
}

function extractAccount(payload: Record<string, unknown>): string | null {
    return readString(payload, 'accountId', 'account_id');
}

function extractList(payload: Record<string, unknown>): string | null {
    return readString(payload, 'listName', 'list_name');
}

export class TimelineStore {
    private entries: TimelineEntry[] = [];

    push(type: string, rawPayload: unknown, timestamp = new Date().toISOString()): void {
        const payload = asJsonObject(rawPayload);
        const entry: TimelineEntry = {
            id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            timestamp,
            accountId: extractAccount(payload),
            listName: extractList(payload),
            summary: summarize(type, payload),
            payload,
        };

        this.entries.unshift(entry);
        if (this.entries.length > MAX_TIMELINE_ENTRIES) {
            this.entries.length = MAX_TIMELINE_ENTRIES;
        }
    }

    replace(entries: TimelineEntry[]): void {
        this.entries = entries.slice(0, MAX_TIMELINE_ENTRIES);
    }

    getEntries(filter: TimelineFilter): TimelineEntry[] {
        return this.entries.filter((entry) => {
            if (filter.type !== 'all' && entry.type !== filter.type) {
                return false;
            }
            if (filter.accountId !== 'all' && entry.accountId !== filter.accountId) {
                return false;
            }
            if (filter.listName !== 'all' && entry.listName !== filter.listName) {
                return false;
            }
            return true;
        });
    }

    getFilterValues(): { types: string[]; accountIds: string[]; listNames: string[] } {
        const types = new Set<string>();
        const accountIds = new Set<string>();
        const listNames = new Set<string>();

        for (const entry of this.entries) {
            types.add(entry.type);
            if (entry.accountId) accountIds.add(entry.accountId);
            if (entry.listName) listNames.add(entry.listName);
        }

        return {
            types: Array.from(types).sort(),
            accountIds: Array.from(accountIds).sort(),
            listNames: Array.from(listNames).sort(),
        };
    }
}
