/**
 * repositories/incidents.ts
 * Domain exports: incidents creation, listing and resolution.
 */

export {
    createIncident,
    countRecentIncidents,
    listOpenIncidents,
    resolveIncident,
} from './legacy';
