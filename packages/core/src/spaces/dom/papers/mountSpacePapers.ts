// Mounts Space paper references with folder navigation and cancellable editing.
import { el, emptyState, closeMenu } from '../../../ui/dom/index.js';
import type { SpaceBody } from '../spaceOverview/index.js';
import type { ResolvedPaper } from '../../viewModel/index.js';
import type { PapersContext } from './papersContext.js';
import { folderNav } from './folders.js';
import { paperRow, action } from './rows.js';
import { confirmRemoval, folderName } from './dialogs.js';
import { paperPicker } from './picker.js';
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
