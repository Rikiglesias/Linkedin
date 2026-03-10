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

// ─── Export Utilities ────────────────────────────────────────────────────────

/**
 * Export an array of row objects to a CSV file and trigger download.
 */
export function exportToCSV(
    rows: Record<string, string | number>[],
    filename: string,
): void {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvLines = [headers.join(',')];
    for (const row of rows) {
        const values = headers.map((h) => {
            const v = row[h];
            if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
                return `"${v.replace(/"/g, '""')}"`;
            }
            return String(v ?? '');
        });
        csvLines.push(values.join(','));
    }
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, filename);
}

/**
 * Download a Chart.js canvas as PNG.
 */
export function downloadCanvasAsPng(canvasId: string, filename: string): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
}

/**
 * Trigger browser print dialog for report.
 */
export function printReport(): void {
    window.print();
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ─── Toast Notifications ─────────────────────────────────────────────────────

export type ToastSeverity = 'success' | 'error' | 'warning' | 'info';

const TOAST_ICONS: Record<ToastSeverity, string> = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
};

const MAX_TOASTS = 5;

export function showToast(
    message: string,
    severity: ToastSeverity = 'info',
    durationMs: number = 4000,
): void {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;

    const safeSeverity: ToastSeverity = severity in TOAST_ICONS ? severity : 'info';
    const toast = document.createElement('div');
    toast.className = `toast toast--${safeSeverity}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
        <span class="toast-icon">${TOAST_ICONS[safeSeverity]}</span>
        <span class="toast-body">${escapeHtml(message)}</span>
    `;

    stack.appendChild(toast);

    // Limita il numero massimo di toast visibili
    while (stack.children.length > MAX_TOASTS) {
        stack.removeChild(stack.children[0] as Node);
    }

    // Auto-dismiss dopo durationMs
    setTimeout(() => {
        toast.classList.add('toast-removing');
        setTimeout(() => {
            if (toast.parentNode === stack) {
                stack.removeChild(toast);
            }
        }, 300);
    }, durationMs);
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
