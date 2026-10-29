/**
 * Handles the list panel's messages: validates them, answers them (paper actions, folder actions, the file tray, the
 * detail pane's data, project sources and the Space sidebar's actions) and shows failures as notices.
 */
import * as vscode from 'vscode';
import {
  PDF_FILE,
  addPaperNote,
  cancelPaperCell,
  createPaperFiles,
  createSidecarReader,
  derivePaperDetails,
  editPaperNote,
  formatError,
  formatKeptFieldNotice,
  installPaperPython,
  isShareMessage,
  movePaperFolders,
  parseUiMessage,
  removePaperNote,
  removePapers,
  runPaperCell,
  sendPaperDetails,
  setPaperTags,
  type HostToUi,
  type ILogger,
  type LibraryUiHost,
  type PaperDetails,
  type PaperFilesState,
  type PaperRecord,
  type ReadingStatus,
  type SimilarPaper,
  type SpaceStore,
  type SpacesHostPort,
  type UiToHost,
  type SidebarSpaceMessage,
} from '@labshelf/core';
import { LOG_MODULE, importCitationWork, showCitationMap } from './citationMap.js';
import type { ListPanelDeps } from './listPanel.js';
import type { LibraryPaths } from './paths.js';

export interface ListHostContext {
  deps: ListPanelDeps;
  /** The path mapping, or null while no library is configured. */
  paths(): LibraryPaths | null;
  post(message: HostToUi): Promise<void>;
  notice(kind: 'info' | 'ok' | 'error', text: string): void;
  /** The records of `ids` that exist, in the order given. */
  papers(ids: readonly string[]): Promise<PaperRecord[]>;
  /** The UI mounted: push the library. */
  onReady(): Promise<void>;
  /** The UI opened a folder (absolute path). */
  onNavigate(dir: string): void;
  /** The UI's selection changed; empty when nothing is selected. */
  onSelect(ids: string[]): void;
}

/** @param file "/"-separated path below the project folder; @param line zero-based. */
export async function openProjectSource(ctx: ListHostContext, project: string, file: string, line: number): Promise<void> {
  const folder = ctx.deps.projectBacklinks?.projectFolder(project);
  if (!folder) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List asked for a source of a project that is not here', { project, file });
    ctx.notice('error', `The project "${project}" is not in the Writing view`);
    return;
  }
  const path = ctx.deps.pathOps;
  const target = path.resolve(folder, ...file.split('/'));
  const relative = path.relative(folder, target);
  // The webview is untrusted: a path that leaves the project folder is not opened.
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List asked for a source outside its project folder', { project, file });
    return;
  }
  await ctx.deps.logger.log('INFO', LOG_MODULE, 'List opens a project source', { project, file, line });
  const position = new vscode.Position(line, 0);
  await vscode.window.showTextDocument(vscode.Uri.file(target), { selection: new vscode.Range(position, position) });
}

const NO_PORT: PaperFilesState = { status: 'failed', message: 'This window cannot list paper files' };

// The webview is untrusted; parseUiMessage already checks the name, and this keeps the path inside the paper folder
// even if that guard changes.
const isOneSegment = (name: string): boolean => name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name);

async function sendFiles(ctx: ListHostContext, id: string): Promise<void> {
  const port = ctx.deps.paperFiles;
  if (!port) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List asked for paper files without a file port', { id });
    await ctx.post({ type: 'files', id, state: NO_PORT });
    return;
  }
  let state: PaperFilesState;
  try {
    state = await port.list(id);
  } catch (err) {
    const message = formatError(err);
    await ctx.deps.logger.log('ERROR', LOG_MODULE, 'Listing paper files failed', { id, message });
    state = { status: 'failed', message };
  }
  await ctx.post({ type: 'files', id, state });
}

async function describeFile(ctx: ListHostContext, id: string, name: string, description: string): Promise<void> {
  const port = ctx.deps.paperFiles;
  if (!port) { await sendFiles(ctx, id); return; }
  const state = await port.describe(id, name, description);
  if (!state) { ctx.notice('error', `Could not describe "${name}" — it is not a file of this paper`); return; }
  await ctx.post({ type: 'files', id, state });
}

// The absolute path of one entry of a paper folder, or undefined (with a notice for a bad name) when it cannot be one.
async function entryUri(ctx: ListHostContext, id: string, name: string): Promise<vscode.Uri | undefined> {
  if (!isOneSegment(name)) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List sent a file name that leaves the paper folder', { id, name });
    ctx.notice('error', `"${name}" is not a file of this paper`);
    return undefined;
  }
  const [paper] = await ctx.papers([id]);
  return paper && vscode.Uri.file(ctx.deps.pathOps.join(paper.path, name));
}

async function openFile(ctx: ListHostContext, uri: vscode.Uri): Promise<void> {
  const stat = await vscode.workspace.fs.stat(uri);
  if ((stat.type & vscode.FileType.Directory) !== 0) {
    await vscode.commands.executeCommand('revealInExplorer', uri);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.Beside);
}

async function onEntryMessage(ctx: ListHostContext, m: UiToHost & { name: string; id: string }): Promise<void> {
  const uri = await entryUri(ctx, m.id, m.name);
  if (!uri) { return; }
  if (m.type === 'paper.openFile') { await openFile(ctx, uri); }
  if (m.type === 'paper.revealFile') { await vscode.commands.executeCommand('revealFileInOS', uri); }
  if (m.type === 'paper.copyFilePath') {
    await vscode.env.clipboard.writeText(uri.fsPath);
    ctx.notice('ok', `Copied the path of ${m.name}`);
  }
}

/** @returns whether the message was a file-tray message, which it then handled */
export async function onPaperFileMessage(ctx: ListHostContext, m: UiToHost): Promise<boolean> {
  switch (m.type) {
    case 'paper.files': await sendFiles(ctx, m.id); return true;
    case 'paper.describeFile': await describeFile(ctx, m.id, m.name, m.description); return true;
    case 'paper.openFile':
    case 'paper.revealFile':
    case 'paper.copyFilePath': await onEntryMessage(ctx, m); return true;
    default: return false;
  }
}

async function pdfOnDevice(ctx: ListHostContext, paperPath: string, hasPdf: boolean | undefined): Promise<PaperDetails['pdf']> {
  if (hasPdf === false) { return null; }
  const file = createPaperFiles(paperPath, ctx.deps.pathOps.join).pdf;
  try {
    const { size } = await vscode.workspace.fs.stat(vscode.Uri.file(file));
    const root = ctx.paths()?.root;
    return { size, relPath: root ? file.slice(root.length + ctx.deps.pathOps.sep.length) : PDF_FILE };
  } catch {
    // Not synced to this device yet; the pane says so.
    return null;
  }
}

async function paperDetails(ctx: ListHostContext, paper: PaperRecord): Promise<PaperDetails> {
  const load = ctx.deps.loadSidecar;
  const sidecar = load ? await createSidecarReader(load, ctx.deps.logger, LOG_MODULE).summaryOf(paper.id) : { annotations: [] };
  const details = derivePaperDetails(sidecar, await pdfOnDevice(ctx, paper.path, paper.hasPdf));
  const backlinks = ctx.deps.projectBacklinks;
  if (backlinks) { details.citedIn = [...backlinks.index().get(paper.citeKey) ?? []]; }
  return details;
}

async function sendSimilar(ctx: ListHostContext, id: string): Promise<void> {
  const find = ctx.deps.findSimilar;
  const [paper] = await ctx.papers([id]);
  let items: SimilarPaper[] = [];
  if (find && paper) {
    try {
      items = (await find(paper)).filter((item) => item.paperId !== id);
    } catch (error) {
      // The AI index is optional; Related still shows the metadata groups.
      await ctx.deps.logger.log('WARN', LOG_MODULE, 'Similar papers could not be found', { paperId: id, message: String(error) });
    }
  }
  await ctx.post({ type: 'similar', id, items });
}

export interface SidebarSpacesDep {
  current(): { store: SpaceStore; port: SpacesHostPort; logger: ILogger } | undefined;
  onDidChange: vscode.Event<void>;
  createSpace(): Promise<string | undefined>;
}

async function askName(prompt: string, value?: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({ prompt, ...(value === undefined ? {} : { value }),
    validateInput: (text) => text.trim() ? undefined : "Enter a name." });
  return name?.trim() || undefined;
}

async function run(m: SidebarSpaceMessage, spaces: SidebarSpacesDep): Promise<void> {
  const current = spaces.current();
  if (!current) return;
  const { store, port } = current;
  const ask = async (prompt: string, value?: string): Promise<string | undefined> => {
    const name = await askName(prompt, value);
    if (spaces.current()?.store !== store) throw new Error("The library changed while naming the Space or folder");
    return name;
  };
  switch (m.action) {
    case "openCatalog": await port.openCatalog(); break;
    case "newSpace": await spaces.createSpace(); break;
    case "openSpace": await port.openSpace(m.id, m.folder ? "papers" : undefined); break;
    case "openPaper": await port.openPaper(m.id); break;
    case "deleteSpace": await store.deleteSpace(m.id); break;
    case "renameSpace": {
      const result = await store.read(m.id);
      if (result.state !== "ready") return;
      const name = await ask("Space name", result.space.name);
      if (name) await store.renameSpace(m.id, name);
      break;
    }
    case "newFolder": { const name = await ask("Folder name"); if (name) await store.createFolder(m.spaceId, name, m.parent); break; }
    case "renameFolder": {
      const name = await ask("Folder name");
      if (name) await store.renameFolder(m.spaceId, m.folder, name);
      break;
    }
    case "deleteFolder": await store.deleteFolder(m.spaceId, m.folder); break;
    case "dropPapers": await store.addPapers(m.spaceId, m.paperIds, m.folder); break;
    case "removeReference": await store.removePaper(m.spaceId, m.paperId); break;
  }
}

export async function answerSidebarSpaceMessage(m: SidebarSpaceMessage, spaces: SidebarSpacesDep): Promise<void> {
  const logger = spaces.current()?.logger;
  try { await run(m, spaces); }
  catch (error) {
    await logger?.error("sidebar.spaces", error, { action: m.action });
    await vscode.window.showErrorMessage(`Space action failed: ${formatError(error)}`);
  }
}

async function setStatus(ctx: ListHostContext, ids: string[], status: ReadingStatus): Promise<void> {
  const failed = await ctx.deps.paperService.updatePapersStatus(ids, status);
  if (failed.length) { ctx.notice('error', formatKeptFieldNotice('status', failed.length, 'not found in the library')); }
}

/** The port the core paper handlers answer through; the index pushes its own changes, so refresh does nothing. */
function libraryUiHost(ctx: ListHostContext): LibraryUiHost {
  const service = ctx.deps.paperService;
  return {
    papers: (ids) => ctx.papers(ids),
    post: (m) => ctx.post(m),
    notice: (kind, text) => ctx.notice(kind, text),
    refresh: async () => {},
    editTags: (ids, add, remove) => service.editTags([...ids], add, remove),
    ...(ctx.deps.paperNotes ? { notes: ctx.deps.paperNotes } : {}),
    ...(ctx.deps.runCell ? { runCell: ctx.deps.runCell } : {}),
    ...(ctx.deps.installPython ? { installPython: ctx.deps.installPython } : {}),
    trashPapers: (papers) => service.trashPapers(papers.map((p) => p.id)),
    movePapers: (ids, target) => service.movePapers([...ids], target),
    folderName: (target) => (target === ctx.paths()?.root ? undefined : ctx.deps.pathOps.basename(target)),
    details: (paper) => paperDetails(ctx, paper),
  };
}

async function writeClipboard(ctx: ListHostContext, text: string, label: string | undefined): Promise<void> {
  if (!text) { return; }
  await vscode.env.clipboard.writeText(text);
  ctx.notice('ok', `Copied ${label ?? 'text'}`);
}

async function revealPaper(ctx: ListHostContext, id: string): Promise<void> {
  const [paper] = await ctx.papers([id]);
  if (paper) { await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(paper.path)); }
}

/** Runs an extension command for the UI and logs what it asked for. */
async function runCommand(ctx: ListHostContext, command: string, ...args: unknown[]): Promise<void> {
  await ctx.deps.logger.log('INFO', LOG_MODULE, 'List runs a command', { command });
  await vscode.commands.executeCommand(command, ...args);
}

const FAILURE: Partial<Record<UiToHost['type'], string>> = {
  'paper.addToSpace': 'Could not add papers to Space',
  'folder.create': 'Could not create the folder', 'folder.rename': 'Could not rename the folder', 'folder.delete': 'Could not delete the folder',
  'paper.move': 'Could not move the papers', 'paper.remove': 'Could not remove the papers', 'paper.setStatus': 'Could not change the status',
  'paper.setTags': 'Could not change the tags', 'project.openSource': 'Could not open the source', 'clipboard.write': 'Could not copy',
  'paper.describeFile': 'Could not save the file description', 'paper.openFile': 'Could not open the file',
  'paper.addNote': 'Could not add the note', 'paper.editNote': 'Could not save the note', 'paper.removeNote': 'Could not remove the note',
  'paper.revealFile': 'Could not reveal the file', 'paper.copyFilePath': 'Could not copy the path',
};

async function onFolderMessage(ctx: ListHostContext, m: UiToHost, toDisk: (ui: string) => string): Promise<boolean> {
  switch (m.type) {
    case 'navigate': ctx.onNavigate(toDisk(m.folder)); return true;
    case 'folder.create': await ctx.deps.folders.create(toDisk(m.parent), m.name); return true;
    case 'folder.rename': await ctx.deps.folders.rename(toDisk(m.path), m.name); return true;
    case 'folder.delete': await ctx.deps.folders.trash(toDisk(m.path)); return true;
    case 'paper.move': await movePaperFolders(libraryUiHost(ctx), m.ids, toDisk(m.target)); return true;
    // Imports land in the folder being viewed, not at the library root.
    case 'paper.add': await runCommand(ctx, 'labshelf.addPaperHere', { label: m.folder.split('/').pop(), dirPath: toDisk(m.folder) }); return true;
    default: return false;
  }
}

/** A note change for a paper that is not in the library writes nothing; the throw reaches the action's failure notice. */
async function requirePaper(ctx: ListHostContext, id: string): Promise<void> {
  if (!(await ctx.papers([id])).length) { throw new Error('the paper is not in the library'); }
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
    case 'paper.details': await sendPaperDetails(libraryUiHost(ctx), m.id); return true;
    case 'paper.similar': await sendSimilar(ctx, m.id); return true;
    case 'paper.setStatus': await setStatus(ctx, m.ids, m.status); return true;
    case 'paper.setTags': await setPaperTags(libraryUiHost(ctx), m.ids, m.add, m.remove); return true;
    case 'paper.addNote': await requirePaper(ctx, m.id); await addPaperNote(libraryUiHost(ctx), m.id, m.body); return true;
    case 'paper.editNote': await requirePaper(ctx, m.id); await editPaperNote(libraryUiHost(ctx), m.id, m.itemId, m.body); return true;
    case 'paper.removeNote': await requirePaper(ctx, m.id); await removePaperNote(libraryUiHost(ctx), m.id, m.itemId); return true;
    case 'paper.runCell': await runPaperCell(libraryUiHost(ctx), m); return true;
    case 'paper.cancelCell': cancelPaperCell(m.requestId); return true;
    case 'paper.installPython': installPaperPython(libraryUiHost(ctx)); return true;
    case 'paper.remove': await removePapers(libraryUiHost(ctx), m.ids); return true;
    case 'project.openSource': await openProjectSource(ctx, m.project, m.file, m.line); return true;
    case 'clipboard.write': await writeClipboard(ctx, m.text, m.label); return true;
    case 'citationMap.refresh': await showCitationMap(ctx); return true;
    case 'citationMap.import': await importCitationWork(ctx, m.workId, m.doi); return true;
    default: return false;
  }
}

export async function answerListMessage(ctx: ListHostContext, raw: unknown): Promise<void> {
  const m = parseUiMessage(raw);
  const paths = ctx.paths();
  if (!m) {
    if (isShareMessage(raw)) { return; }
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
    const message = formatError(error);
    await ctx.deps.logger.log('ERROR', LOG_MODULE, 'List action failed', { type: m.type, message });
    ctx.notice('error', `${FAILURE[m.type] ?? 'The action failed'} — ${message}`);
  }
}

