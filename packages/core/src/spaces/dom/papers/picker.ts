// Selects Library papers to add to the current Space folder.
import { renderElement, renderEmptyNotice, mountFormDialog } from '../../../ui/dom/index.js';
import type { PapersContext } from './papersContext.js';
export function openPaperPicker(ctx: PapersContext): void {
  if (ctx.readOnly || ctx.signal?.aborted) return;
  const selected = new Set<string>();
  const search = renderElement('input', { type: 'search', class: 'ls-input', 'aria-label': 'Search Library papers', placeholder: 'Search papers' });
  const list = renderElement('div', { class: 'pp-picker-list' });
  const form = renderElement('form', { class: 'ls-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add papers' },
    renderElement('h2', { text: 'Add papers' }), search, list);
  const existing = new Set(ctx.data.space.papers.map(p => p.id));
  const unsubscribe = ctx.end.subscribe(message => {
    if (message.type !== 'papers') return;
    list.replaceChildren(...message.items.filter(p => !existing.has(p.id)).map(p => {
      const checkbox = renderElement('input', { type: 'checkbox', name: 'paperIds', value: p.id }); checkbox.checked = selected.has(p.id);
      checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(p.id); else selected.delete(p.id); });
      return renderElement('label', { class: 'pp-pick', 'data-search': `${p.title} ${p.authors.join(' ')}`.toLocaleLowerCase() }, checkbox, p.title);
    }));
    if (!list.childElementCount) list.append(renderEmptyNotice({ inline: true, text: 'No papers to add.' }));
    filter();
  });
  const filter = (): void => { for (const row of list.querySelectorAll<HTMLElement>('[data-search]')) row.hidden = !row.dataset['search']!.includes(search.value.toLocaleLowerCase()); };
  search.addEventListener('input', filter);
  const close = mountFormDialog(form, { submitLabel: 'Add', unsubscribe, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  form.addEventListener('submit', e => {
    e.preventDefault(); if (!selected.size || ctx.readOnly || ctx.signal?.aborted) return;
    ctx.end.post({ type: 'addPapers', id: ctx.data.space.id, paperIds: [...selected], ...(ctx.folder ? { folder: ctx.folder } : {}) }); close();
  }); search.focus(); ctx.end.post({ type: 'listPapers' });
}
