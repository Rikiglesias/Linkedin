import { asJsonObject, readString } from './dom';
const MAX_TIMELINE_ENTRIES = 300;
function summarize(type, payload) {
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
function extractAccount(payload) {
    return readString(payload, 'accountId', 'account_id');
}
function extractList(payload) {
    return readString(payload, 'listName', 'list_name');
}
export class TimelineStore {
    entries = [];
    push(type, rawPayload, timestamp = new Date().toISOString()) {
        const payload = asJsonObject(rawPayload);
        const entry = {
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
    replace(entries) {
        this.entries = entries.slice(0, MAX_TIMELINE_ENTRIES);
    }
    getEntries(filter) {
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
    getFilterValues() {
        const types = new Set();
        const accountIds = new Set();
        const listNames = new Set();
        for (const entry of this.entries) {
            types.add(entry.type);
            if (entry.accountId)
                accountIds.add(entry.accountId);
            if (entry.listName)
                listNames.add(entry.listName);
        }
        return {
            types: Array.from(types).sort(),
            accountIds: Array.from(accountIds).sort(),
            listNames: Array.from(listNames).sort(),
        };
    }
}
