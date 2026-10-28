// Mounts Space paper references with folder navigation, cancellable editing dialogs and the Library paper picker.
import { renderElement, renderEmptyNotice, closeMenu, renderIcon, showMenu, askInputBox, mountOverlay, mountFormDialog } from "../../ui/dom/index.js";
import type { OverviewContext, SpaceBody } from "./mountOverview.js";
import type { ResolvedPaper, PapersTreeFolder } from "../spaceViews.js";
import { renderReadingStatusMark } from "../../ui/icons/index.js";

interface PapersContext extends OverviewContext { folder?: string }


const PAPER_DRAG_TYPE = 'application/x-labshelf-space-paper';
function paperRow(ctx: PapersContext, paper: ResolvedPaper): HTMLElement {
  const row = renderElement('li', { class: 'pp-row', 'data-paper-id': paper.id });
  const remove = action(ctx, 'Remove', () => askRemoval(ctx, { paperId: paper.id }));
  if (paper.missing) { row.classList.add('pp-missing'); row.append(renderElement('span', { text: `${paper.id} — Not in your Library` }), remove); return row; }
  const title = renderElement('button', { type: 'button', class: 'pp-title', title: paper.title, text: paper.title });
  title.addEventListener('click', () => ctx.end.post({ type: 'selectPaper', paperId: paper.id }));
  title.addEventListener('dblclick', () => ctx.end.post({ type: 'openPaper', paperId: paper.id }));
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ctx.end.post({ type: 'openPaper', paperId: paper.id }); } });
  const focus = ctx.data.space.papers.find(p => p.id === paper.id)?.focus ?? false;
  const toggle = action(ctx, 'In focus', () => ctx.end.post({ type: 'setFocus', id: ctx.data.space.id, paperId: paper.id, focus: !focus }));
  toggle.setAttribute('aria-pressed', String(focus)); toggle.classList.toggle('on', focus);
  const move = action(ctx, 'Move to folder', () => showMoveMenu(ctx, paper.id, move));
  const status = { unread: 'Unread', reading: 'Reading', done: 'Done' }[paper.status];
  row.append(renderElement('span', { class: 'pp-status', role: 'img', 'aria-label': status, title: status, html: renderReadingStatusMark(paper.status) }),
    renderElement('div', { class: 'pp-main' }, title, renderElement('div', { class: 'pp-meta', text: [...paper.authors, paper.year].filter(Boolean).join(' · ') })),
    renderElement('div', { class: 'pp-acts' }, toggle, move, remove));
  row.draggable = !ctx.readOnly;
  row.addEventListener('dragstart', e => { if (!ctx.readOnly) e.dataTransfer?.setData(PAPER_DRAG_TYPE, JSON.stringify({ spaceId: ctx.data.space.id, paperId: paper.id })); });
  return row;
}
function action(ctx: PapersContext, label: string, handler: () => void): HTMLButtonElement {
  const button = renderElement('button', { type: 'button', class: 'ls-btn ls-btn-ghost', text: label, disabled: ctx.readOnly });
  button.addEventListener('click', () => { if (!ctx.readOnly && !ctx.signal?.aborted) handler(); }); return button;
}
function showMoveMenu(ctx: PapersContext, paperId: string, anchor: HTMLElement): void {
  const move = (folder?: string): void => { if (!ctx.readOnly && !ctx.signal?.aborted) ctx.end.post({ type: 'moveReference', id: ctx.data.space.id, paperId, ...(folder ? { folder } : {}) }); };
  showMenu(anchor, [{ label: 'Space root', onSelect: () => move() }, ...ctx.data.space.folders.map(f => ({ label: f.name, onSelect: () => move(f.id) }))]);
}

function folderNav(ctx: PapersContext, select: (id?: string) => void): HTMLElement {
  const nav = renderElement('nav', { class: 'pp-folders', 'aria-label': 'Space folders' });
  const item = (label: string, count: number, id?: string): HTMLElement => {
    const button = renderElement('button', { type: 'button', class: 'pp-folder', 'aria-label': label, 'aria-current': ctx.folder === id ? 'true' : undefined },
      renderElement('span', { 'aria-hidden': 'true', html: renderIcon(id ? 'folder' : 'layers') }),
      renderElement('span', { class: 'pp-folder-name', text: label }), renderElement('span', { class: 'tree-count', text: String(count) }));
    button.addEventListener('click', () => select(id)); wireDrop(button, ctx, id); return button;
  };
  nav.append(item('All papers', ctx.data.space.papers.length));
  const add = (folders: readonly PapersTreeFolder[], parent: HTMLElement): void => {
    for (const f of folders) {
      parent.append(item(f.name, f.papers.length, f.id));
      if (f.folders.length) { const children = renderElement('div', { class: 'pp-folder-children' }); add(f.folders, children); parent.append(children); }
    }
  };
  add(ctx.data.papers.folders, nav); nav.append(action(ctx, 'New folder', () => { void askFolderName(ctx); })); return nav;
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
  const add = action(ctx, 'Add papers', () => openPaperPicker(ctx));
  const bar = renderElement('div', { class: 'pp-bar' }, renderElement('div', {}, renderElement('h2', { text: 'Papers' }),
    renderElement('p', { class: 'pp-hint', text: 'Papers stay in your Library.' })), add);
  const groups = renderElement('div', { class: 'pp-groups' });
  const folder = ctx.data.space.folders.find(f => f.id === ctx.folder);
  if (folder) groups.append(renderElement('div', { class: 'pp-bar' }, renderElement('h2', { text: folder.name }),
    action(ctx, 'Rename folder', () => { void askFolderName(ctx, folder.id); }), action(ctx, 'Delete folder', () => askRemoval(ctx, { folderId: folder.id }))));
  const papers = visiblePapers(ctx);
  groups.append(papers.length ? renderElement('ul', { class: 'pp-list' }, ...papers.map(p => paperRow(ctx, p))) : renderEmptyNotice({ text: 'No papers yet.', hint: 'Add papers from your Library to this folder.' }));
  return renderElement('div', {}, bar, renderElement('div', { class: 'pp-grid' }, folderNav(ctx, select), groups));
}
function visiblePapers(ctx: PapersContext): ResolvedPaper[] {
  const all: { paper: ResolvedPaper; folder?: string }[] = ctx.data.papers.papers.map(paper => ({ paper }));
  const collect = (node: typeof ctx.data.papers): void => {
    for (const f of node.folders) { all.push(...f.papers.map(paper => ({ paper, folder: f.id }))); collect(f); }
  };
  collect(ctx.data.papers);
  return all.filter(entry => !ctx.folder || entry.folder === ctx.folder).map(entry => entry.paper);
}

async function askFolderName(ctx: PapersContext, folderId?: string): Promise<void> {
  const folder = ctx.data.space.folders.find(f => f.id === folderId);
  const name = await askInputBox({ title: folder ? 'Rename folder' : 'New folder', value: folder?.name ?? '',
    validate: value => value.trim() ? undefined : 'Enter a folder name.', ...(ctx.signal ? { signal: ctx.signal } : {}) });
  if (!name || ctx.readOnly || ctx.signal?.aborted) return;
  ctx.end.post(folder ? { type: 'renameFolder', id: ctx.data.space.id, folderId: folder.id, name }
    : { type: 'createFolder', id: ctx.data.space.id, name, ...(ctx.folder ? { parent: ctx.folder } : {}) });
}
function askRemoval(ctx: PapersContext, item: { paperId: string } | { folderId: string }): void {
  if (ctx.readOnly || ctx.signal?.aborted) return;
  const folder = 'folderId' in item;
  const label = folder ? 'Delete' : 'Remove';
  const form = renderElement('form', { class: 'ls-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': folder ? 'Delete folder' : 'Remove from Space' },
    renderElement('h2', { text: folder ? 'Delete folder?' : 'Remove from Space?' }),
    renderElement('p', { text: folder ? 'References and child folders move to the parent folder.' : 'The paper stays in your Library.' }));
  const { close } = mountOverlay(form, () => {}, ctx.signal ? { signal: ctx.signal } : {});
  const cancel = renderElement('button', { type: 'button', class: 'ls-btn', text: 'Cancel' }); cancel.addEventListener('click', close);
  form.append(renderElement('div', { class: 'ls-dialog-actions' }, cancel, renderElement('button', { type: 'submit', class: 'ls-btn ls-btn-danger', text: label })));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!ctx.readOnly && !ctx.signal?.aborted) ctx.end.post(folder
      ? { type: 'deleteFolder', id: ctx.data.space.id, folderId: item.folderId }
      : { type: 'removePaper', id: ctx.data.space.id, paperId: item.paperId });
    close();
  }); cancel.focus();
}

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
