// Selects Library papers to add to the current Space folder.
import { el, emptyState, mountOverlay } from '../../../ui/dom/index.js';
import type { PapersContext } from './papersContext.js';
export function paperPicker(ctx: PapersContext): void {
  if (ctx.readOnly || ctx.signal?.aborted) return;
  const selected = new Set<string>();
  const search = el('input', { type: 'search', class: 'ls-input', 'aria-label': 'Search Library papers', placeholder: 'Search papers' });
  const list = el('div', { class: 'pp-picker-list' });
  const form = el('form', { class: 'ls-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add papers' },
    el('h2', { text: 'Add papers' }), search, list);
  const existing = new Set(ctx.data.space.papers.map(p => p.id));
  const unsubscribe = ctx.end.subscribe(message => {
    if (message.type !== 'papers') return;
    list.replaceChildren(...message.items.filter(p => !existing.has(p.id)).map(p => {
      const checkbox = el('input', { type: 'checkbox', name: 'paperIds', value: p.id }); checkbox.checked = selected.has(p.id);
      checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(p.id); else selected.delete(p.id); });
      return el('label', { class: 'pp-pick', 'data-search': `${p.title} ${p.authors.join(' ')}`.toLocaleLowerCase() }, checkbox, p.title);
    }));
    if (!list.childElementCount) list.append(emptyState({ inline: true, text: 'No papers to add.' }));
    filter();
  });
  const filter = (): void => { for (const row of list.querySelectorAll<HTMLElement>('[data-search]')) row.hidden = !row.dataset['search']!.includes(search.value.toLocaleLowerCase()); };
  search.addEventListener('input', filter);
  const overlay = mountOverlay(form, unsubscribe, ctx.signal ? { signal: ctx.signal } : {});
  const close = (): void => { unsubscribe(); overlay.close(); };
  const cancel = el('button', { type: 'button', class: 'ls-btn', text: 'Cancel' }); cancel.addEventListener('click', close);
  form.append(el('div', { class: 'ls-dialog-actions' }, cancel, el('button', { type: 'submit', class: 'ls-btn ls-btn-primary', text: 'Add' })));
  form.addEventListener('submit', e => {
    e.preventDefault(); if (!selected.size || ctx.readOnly || ctx.signal?.aborted) return;
    ctx.end.post({ type: 'addPapers', id: ctx.data.space.id, paperIds: [...selected], ...(ctx.folder ? { folder: ctx.folder } : {}) }); close();
  }); search.focus(); ctx.end.post({ type: 'listPapers' });
}
