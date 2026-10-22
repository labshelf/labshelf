// Renders Space paper rows with reference actions and Library navigation.
import { el, showMenu } from '../../../ui/dom/index.js';
import { statusMark } from '../../../ui/icons/index.js';
import type { ResolvedPaper } from '../../view/index.js';
import type { PapersContext } from './context.js';
import { confirmRemoval } from './dialogs.js';
export const PAPER_DRAG_TYPE = 'application/x-labshelf-space-paper';
export function paperRow(ctx: PapersContext, paper: ResolvedPaper): HTMLElement {
  const row = el('li', { class: 'pp-row', 'data-paper-id': paper.id });
  const remove = action(ctx, 'Remove', () => confirmRemoval(ctx, { paperId: paper.id }));
  if (paper.missing) { row.classList.add('pp-missing'); row.append(el('span', { text: `${paper.id} — Not in your Library` }), remove); return row; }
  const title = el('button', { type: 'button', class: 'pp-title', title: paper.title, text: paper.title });
  title.addEventListener('click', () => ctx.end.post({ type: 'selectPaper', paperId: paper.id }));
  title.addEventListener('dblclick', () => ctx.end.post({ type: 'openPaper', paperId: paper.id }));
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ctx.end.post({ type: 'openPaper', paperId: paper.id }); } });
  const focus = ctx.data.space.papers.find(p => p.id === paper.id)?.focus ?? false;
  const toggle = action(ctx, 'In focus', () => ctx.end.post({ type: 'setFocus', id: ctx.data.space.id, paperId: paper.id, focus: !focus }));
  toggle.setAttribute('aria-pressed', String(focus)); toggle.classList.toggle('on', focus);
  const move = action(ctx, 'Move to folder', () => showMoveMenu(ctx, paper.id, move));
  const status = { unread: 'Unread', reading: 'Reading', done: 'Done' }[paper.status];
  row.append(el('span', { class: 'pp-status', role: 'img', 'aria-label': status, title: status, html: statusMark(paper.status) }),
    el('div', { class: 'pp-main' }, title, el('div', { class: 'pp-meta', text: [...paper.authors, paper.year].filter(Boolean).join(' · ') })),
    el('div', { class: 'pp-acts' }, toggle, move, remove));
  row.draggable = !ctx.readOnly;
  row.addEventListener('dragstart', e => { if (!ctx.readOnly) e.dataTransfer?.setData(PAPER_DRAG_TYPE, JSON.stringify({ spaceId: ctx.data.space.id, paperId: paper.id })); });
  return row;
}
export function action(ctx: PapersContext, label: string, handler: () => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'ls-btn ls-btn-ghost', text: label, disabled: ctx.readOnly });
  button.addEventListener('click', () => { if (!ctx.readOnly && !ctx.signal?.aborted) handler(); }); return button;
}
function showMoveMenu(ctx: PapersContext, paperId: string, anchor: HTMLElement): void {
  const move = (folder?: string): void => { if (!ctx.readOnly && !ctx.signal?.aborted) ctx.end.post({ type: 'moveReference', id: ctx.data.space.id, paperId, ...(folder ? { folder } : {}) }); };
  showMenu(anchor, [{ label: 'Space root', onSelect: () => move() }, ...ctx.data.space.folders.map(f => ({ label: f.name, onSelect: () => move(f.id) }))]);
}
