export function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Elemento non trovato: #${id}`);
    }
    return element;
}
export function setText(id, text) {
    byId(id).textContent = text;
}
export function formatDate(iso) {
    if (!iso)
        return '—';
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed))
        return iso;
    return new Date(parsed).toLocaleString('it-IT', { hour12: false });
}
export function formatPercent(num, den) {
    if (!den || den <= 0)
        return '0.0%';
    return `${((num / den) * 100).toFixed(1)}%`;
}
export function clearChildren(node) {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}
export function createCell(text, className) {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className)
        cell.className = className;
    return cell;
}
export function asJsonObject(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return {};
    }
    return input;
}
export function readString(record, ...keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
