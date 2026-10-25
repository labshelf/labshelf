// Mounts Space paper references with folder navigation and cancellable editing.
import { el, emptyState, closeMenu, icon } from "../../../ui/dom/index.js";
import type { SpaceBody } from '../spaceOverview/index.js';
import type { ResolvedPaper, PapersTreeFolder } from "../../viewModel/index.js";
import type { PapersContext } from "./papersContext.js";
import { paperRow, action, PAPER_DRAG_TYPE } from "./rows.js";
import { confirmRemoval, folderName } from "./dialogs.js";
import { paperPicker } from './picker.js';

function folderNav(ctx: PapersContext, select: (id?: string) => void): HTMLElement {
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

export function mountSpacePapers(root: HTMLElement, initial: PapersContext): SpaceBody {
  let controller = new AbortController();
  const ctx: PapersContext = { ...initial, signal: controller.signal };
  const render = (): void => {
    if (ctx.folder && !ctx.data.space.folders.some(f => f.id === ctx.folder)) delete ctx.folder;
    root.replaceChildren(papersSurface(ctx, folder => { if (folder) ctx.folder = folder; else delete ctx.folder; render(); }));
  };
  render();
  return {
    update(data) {
      ctx.data = data; ctx.readOnly = !!data.readOnlyReason;
      if (ctx.readOnly) { controller.abort(); closeMenu(); controller = new AbortController(); ctx.signal = controller.signal; }
      render();
    },
    dispose() { controller.abort(); closeMenu(); root.replaceChildren(); },
  };
}
function papersSurface(ctx: PapersContext, select: (id?: string) => void): HTMLElement {
  const add = action(ctx, 'Add papers', () => paperPicker(ctx));
  const bar = el('div', { class: 'pp-bar' }, el('div', {}, el('h2', { text: 'Papers' }),
    el('p', { class: 'pp-hint', text: 'Papers stay in your Library.' })), add);
  const groups = el('div', { class: 'pp-groups' });
  const folder = ctx.data.space.folders.find(f => f.id === ctx.folder);
  if (folder) groups.append(el('div', { class: 'pp-bar' }, el('h2', { text: folder.name }),
    action(ctx, 'Rename folder', () => { void folderName(ctx, folder.id); }), action(ctx, 'Delete folder', () => confirmRemoval(ctx, { folderId: folder.id }))));
  const papers = visiblePapers(ctx);
  groups.append(papers.length ? el('ul', { class: 'pp-list' }, ...papers.map(p => paperRow(ctx, p))) : emptyState({ text: 'No papers yet.', hint: 'Add papers from your Library to this folder.' }));
  return el('div', {}, bar, el('div', { class: 'pp-grid' }, folderNav(ctx, select), groups));
}
function visiblePapers(ctx: PapersContext): ResolvedPaper[] {
  const all: { paper: ResolvedPaper; folder?: string }[] = ctx.data.papers.papers.map(paper => ({ paper }));
  const collect = (node: typeof ctx.data.papers): void => {
    for (const f of node.folders) { all.push(...f.papers.map(paper => ({ paper, folder: f.id }))); collect(f); }
  };
  collect(ctx.data.papers);
  return all.filter(entry => !ctx.folder || entry.folder === ctx.folder).map(entry => entry.paper);
}
