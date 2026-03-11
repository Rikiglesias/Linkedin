import { DashboardApi } from './apiClient';
import { showToast } from './dom';
import { renderLeadSearchResults, renderLeadDetail } from './renderers';

export function bindLeadSearch(api: DashboardApi): void {
    function doSearch(page: number = 1): void {
        const query = (document.getElementById('lead-search-input') as HTMLInputElement)?.value ?? '';
        const status = (document.getElementById('lead-search-status') as HTMLSelectElement)?.value ?? '';

        const detailEl = document.getElementById('lead-detail-content');
        if (detailEl) detailEl.hidden = true;

        void api.searchLeads(query, status || undefined, undefined, page).then((result) => {
            renderLeadSearchResults(
                result.leads,
                result.total,
                result.page,
                result.pageSize,
                (p) => doSearch(p),
                (leadId) => {
                    void api.getLeadDetail(leadId).then((detail) => {
                        if (!detail) return;
                        const el = document.getElementById('lead-detail-content');
                        if (el) {
                            el.hidden = false;
                            renderLeadDetail(detail.lead, detail.timeline);
                        }
                    });
                },
            );
        }).catch(() => showToast('Errore ricerca lead', 'error'));
    }

    document.getElementById('btn-lead-search')?.addEventListener('click', () => doSearch(1));
    document.getElementById('lead-search-input')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') doSearch(1);
    });
}

export function bindBlacklist(api: DashboardApi): void {
    async function loadBlacklist(): Promise<void> {
        const entries = await api.getBlacklist();
        const tbody = document.getElementById('blacklist-tbody');
        const countEl = document.getElementById('blacklist-count');
        if (!tbody) return;
        if (countEl) countEl.textContent = `${entries.length} entry`;
        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nessuna entry in blacklist</td></tr>';
            return;
        }
        tbody.innerHTML = entries.map((e) => {
            const date = e.created_at ? new Date(e.created_at).toLocaleDateString('it-IT') : '\u2014';
            const safeUrl = (e.linkedin_url ?? '\u2014').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeDomain = (e.company_domain ?? '\u2014').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeReason = (e.reason ?? '\u2014').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<tr>
                <td>${safeUrl}</td>
                <td>${safeDomain}</td>
                <td>${safeReason}</td>
                <td>${date}</td>
                <td><button class="btn-remove-blacklist" data-id="${e.id}">Rimuovi</button></td>
            </tr>`;
        }).join('');
    }

    document.getElementById('btn-blacklist-add')?.addEventListener('click', () => {
        const url = (document.getElementById('blacklist-url') as HTMLInputElement)?.value.trim() ?? '';
        const domain = (document.getElementById('blacklist-domain') as HTMLInputElement)?.value.trim() ?? '';
        const reason = (document.getElementById('blacklist-reason') as HTMLInputElement)?.value.trim() ?? '';
        if (!url && !domain) {
            showToast('Inserisci almeno un URL o dominio', 'warning');
            return;
        }
        void api.addToBlacklist(url, domain, reason).then((ok) => {
            showToast(ok ? 'Aggiunto alla blacklist' : 'Errore aggiunta blacklist', ok ? 'success' : 'error');
            if (ok) {
                (document.getElementById('blacklist-url') as HTMLInputElement).value = '';
                (document.getElementById('blacklist-domain') as HTMLInputElement).value = '';
                (document.getElementById('blacklist-reason') as HTMLInputElement).value = '';
                void loadBlacklist();
            }
        }).catch(() => showToast('Errore di rete', 'error'));
    });

    document.getElementById('blacklist-tbody')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target.classList.contains('btn-remove-blacklist')) return;
        const id = Number.parseInt(target.dataset.id ?? '', 10);
        if (!Number.isFinite(id)) return;
        void api.removeFromBlacklist(id).then((ok) => {
            showToast(ok ? 'Rimosso dalla blacklist' : 'Errore rimozione', ok ? 'success' : 'error');
            if (ok) void loadBlacklist();
        }).catch(() => showToast('Errore di rete', 'error'));
    });

    void loadBlacklist();
}
