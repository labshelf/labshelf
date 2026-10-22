// Renders nested Space folders as reference drop targets.
import { el, icon } from '../../../ui/dom/index.js';
import type { PapersTreeFolder } from '../../view/index.js';
import type { PapersContext } from './context.js';
import { action, PAPER_DRAG_TYPE } from './rows.js';
import { folderName } from './dialogs.js';
export function folderNav(ctx: PapersContext, select: (id?: string) => void): HTMLElement {
  const nav = el('nav', { class: 'pp-folders', 'aria-label': 'Space folders' });
  const item = (label: string, count: number, id?: string): HTMLElement => {
    const button = el('button', { type: 'button', class: 'pp-folder', 'aria-label': label, 'aria-current': ctx.folder === id ? 'true' : undefined },
      el('span', { 'aria-hidden': 'true', html: icon(id ? 'folder' : 'layers') }),
      el('span', { class: 'pp-folder-name', text: label }), el('span', { class: 'tree-count', text: String(count) }));
    button.addEventListener('click', () => select(id)); wireDrop(button, ctx, id); return button;
  };
  nav.append(item('All papers', ctx.data.space.papers.length));
  const add = (folders: readonly PapersTreeFolder[], parent: HTMLElement): void => {
    for (const f of folders) {
      parent.append(item(f.name, f.papers.length, f.id));
      if (f.folders.length) { const children = el('div', { class: 'pp-folder-children' }); add(f.folders, children); parent.append(children); }
    }
  };
  add(ctx.data.papers.folders, nav); nav.append(action(ctx, 'New folder', () => { void folderName(ctx); })); return nav;
}
function wireDrop(button: HTMLElement, ctx: PapersContext, folder?: string): void {
  button.addEventListener('dragover', event => { if (!ctx.readOnly && event.dataTransfer?.types.includes(PAPER_DRAG_TYPE)) event.preventDefault(); });
  button.addEventListener('drop', event => {
    event.preventDefault(); if (ctx.readOnly || ctx.signal?.aborted) return;
    let payload: unknown;
    try { payload = JSON.parse(event.dataTransfer?.getData(PAPER_DRAG_TYPE) ?? 'null'); } catch { return; }
    if (!payload || typeof payload !== 'object' || !('spaceId' in payload) || payload.spaceId !== ctx.data.space.id || !('paperId' in payload) || typeof payload.paperId !== 'string') return;
    if (!ctx.data.space.papers.some(p => p.id === payload.paperId)) return;
    ctx.end.post({ type: 'moveReference', id: ctx.data.space.id, paperId: payload.paperId, ...(folder ? { folder } : {}) });
  });
}
