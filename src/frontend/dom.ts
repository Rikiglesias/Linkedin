export function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Elemento non trovato: #${id}`);
    }
    return element as T;
}

export function setText(id: string, text: string): void {
    byId<HTMLElement>(id).textContent = text;
}

export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return iso;
    return new Date(parsed).toLocaleString('it-IT', { hour12: false });
}

export function formatPercent(num: number, den: number): string {
    if (!den || den <= 0) return '0.0%';
    return `${((num / den) * 100).toFixed(1)}%`;
}

export function clearChildren(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

export function createCell(text: string, className?: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
}

export function asJsonObject(input: unknown): Record<string, unknown> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return {};
    }
    return input as Record<string, unknown>;
}

export function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
