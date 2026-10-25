// Validates list messages before dispatching host actions with visible failure notices.
import { errorMessage, isSharingMessage, parseUiMessage, type UiToHost } from '@labshelf/core';
import { LOG_MODULE, type ListHostContext } from './hostContext.js';
import { movePapers, removePapers, revealPaper, runCommand, setNote, setStatus, setTags, writeClipboard } from './paperHandlers.js';
import { importCitationWork, showCitationMap } from '../citationMap/index.js';
import { sendDetails, sendSimilar } from './answerDetailPane.js';
import { openProjectSource } from './projectSource.js';
import { onPaperFileMessage } from './paperFileHandlers.js';

const FAILURE: Partial<Record<UiToHost['type'], string>> = {
  'paper.addToSpace': 'Could not add papers to Space',
  'folder.create': 'Could not create the folder', 'folder.rename': 'Could not rename the folder', 'folder.delete': 'Could not delete the folder',
  'paper.move': 'Could not move the papers', 'paper.remove': 'Could not remove the papers', 'paper.setStatus': 'Could not change the status',
  'paper.setTags': 'Could not change the tags', 'project.openSource': 'Could not open the source', 'paper.setNote': 'Could not save the note', 'clipboard.write': 'Could not copy',
  'paper.describeFile': 'Could not save the file description', 'paper.openFile': 'Could not open the file',
  'paper.revealFile': 'Could not reveal the file', 'paper.copyFilePath': 'Could not copy the path',
};

async function onFolderMessage(ctx: ListHostContext, m: UiToHost, toDisk: (ui: string) => string): Promise<boolean> {
  switch (m.type) {
    case 'navigate': ctx.onNavigate(toDisk(m.folder)); return true;
    case 'folder.create': await ctx.deps.folders.create(toDisk(m.parent), m.name); return true;
    case 'folder.rename': await ctx.deps.folders.rename(toDisk(m.path), m.name); return true;
    case 'folder.delete': await ctx.deps.folders.trash(toDisk(m.path)); return true;
    case 'paper.move': await movePapers(ctx, m.ids, toDisk(m.target)); return true;
    // Imports land in the folder being viewed, not at the library root.
    case 'paper.add': await runCommand(ctx, 'labshelf.addPaperHere', { label: m.folder.split('/').pop(), dirPath: toDisk(m.folder) }); return true;
    default: return false;
  }
}

async function onPaperMessage(ctx: ListHostContext, m: UiToHost): Promise<boolean> {
  switch (m.type) {
    case 'ready': await ctx.onReady(); return true;
    case 'paper.addToSpace':
      if (ctx.deps.addToSpace && await ctx.deps.addToSpace(m.ids)) { ctx.notice('ok', 'Added to Space'); }
      return true;
    case 'paper.selected': ctx.onSelect(m.ids); return true;
    case 'paper.open': await runCommand(ctx, 'labshelf.openPdfViewer', m.id, ...(m.page ? [m.page] : [])); return true;
    case 'paper.openExternal': await runCommand(ctx, 'labshelf.openPaperPdfExternal', m.id); return true;
    case 'paper.reveal': await revealPaper(ctx, m.id); return true;
    case 'paper.fetchMetadata': await runCommand(ctx, 'labshelf.fetchMetadata', m.id); return true;
    case 'paper.makeSearchable': await runCommand(ctx, 'labshelf.makeSearchable', m.ids); return true;
    case 'annotations.export': await runCommand(ctx, 'labshelf.exportAnnotations', m.id, 'file'); return true;
    case 'paper.details': await sendDetails(ctx, m.id); return true;
    case 'paper.similar': await sendSimilar(ctx, m.id); return true;
    case 'paper.setStatus': await setStatus(ctx, m.ids, m.status); return true;
    case 'paper.setTags': await setTags(ctx, m.ids, m.add, m.remove); return true;
    case 'paper.setNote': await setNote(ctx, m.id, m.note); return true;
    case 'paper.remove': await removePapers(ctx, m.ids); return true;
    case 'project.openSource': await openProjectSource(ctx, m.project, m.file, m.line); return true;
    case 'clipboard.write': await writeClipboard(ctx, m.text, m.label); return true;
    case 'citationMap.refresh': await showCitationMap(ctx); return true;
    case 'citationMap.import': await importCitationWork(ctx, m.workId, m.doi); return true;
    default: return false;
  }
}

export async function handleListMessage(ctx: ListHostContext, raw: unknown): Promise<void> {
  const m = parseUiMessage(raw);
  const paths = ctx.paths();
  if (!m) {
    if (isSharingMessage(raw)) { return; }
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List webview sent a message that is not valid', { type: (raw as { type?: unknown } | null)?.type });
    return;
  }
  try {
    if (await onPaperMessage(ctx, m)) { return; }
    if (paths && await onFolderMessage(ctx, m, (ui) => paths.fromUi(ui))) { return; }
    if (await onPaperFileMessage(ctx, m)) { return; }
    // Find PDF, Attach PDF and adding from a source are browser capabilities this panel does not declare.
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List webview sent a message this host does not offer', { type: m.type });
  } catch (error) {
    const message = errorMessage(error);
    await ctx.deps.logger.log('ERROR', LOG_MODULE, 'List action failed', { type: m.type, message });
    ctx.notice('error', `${FAILURE[m.type] ?? 'The action failed'} — ${message}`);
  }
}
