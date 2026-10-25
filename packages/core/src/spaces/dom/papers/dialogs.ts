// Edits folder names and confirms reference removals in cancellable overlays.
import { renderElement, askInputBox, mountOverlay } from '../../../ui/dom/index.js';
import type { PapersContext } from './papersContext.js';
export async function askFolderName(ctx: PapersContext, folderId?: string): Promise<void> {
  const folder = ctx.data.space.folders.find(f => f.id === folderId);
  const name = await askInputBox({ title: folder ? 'Rename folder' : 'New folder', value: folder?.name ?? '',
    validate: value => value.trim() ? undefined : 'Enter a folder name.', ...(ctx.signal ? { signal: ctx.signal } : {}) });
  if (!name || ctx.readOnly || ctx.signal?.aborted) return;
  ctx.end.post(folder ? { type: 'renameFolder', id: ctx.data.space.id, folderId: folder.id, name }
    : { type: 'createFolder', id: ctx.data.space.id, name, ...(ctx.folder ? { parent: ctx.folder } : {}) });
}
export function askRemoval(ctx: PapersContext, item: { paperId: string } | { folderId: string }): void {
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
