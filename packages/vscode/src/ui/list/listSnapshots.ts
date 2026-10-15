/**
 * Reads the library as the list UI renders it: every paper record with its path in UI form, the folder tree, which
 * papers have their PDF here, and each paper's reading stats from its sidecar.
 */
import { PAPERS_DIR, createSidecarReader, parentDir, type FolderTreeNode, type LibraryUiSnapshot, type PaperRecord } from '@labshelf/core';
import { listAllCollectionFolders } from '../library/index.js';
import type { LibraryPaths } from './libraryPaths.js';
import type { ListPanelDeps } from './listPanelDeps.js';

const LOG_MODULE = 'ui/list/listSnapshots';

async function folderTree(deps: ListPanelDeps, paths: LibraryPaths): Promise<FolderTreeNode[]> {
  const top: FolderTreeNode[] = [];
  const byPath = new Map<string, FolderTreeNode>();
  // Parents come before their children, so every child finds its parent already placed.
  for (const folder of await listAllCollectionFolders(deps.readFolders, paths.root)) {
    const ui = paths.toUi(folder.dirPath);
    if (!ui) { continue; }
    const node: FolderTreeNode = { name: folder.label, path: ui, children: [] };
    byPath.set(ui, node);
    const parent = parentDir(ui, '/');
    (parent === PAPERS_DIR ? top : byPath.get(parent)?.children ?? top).push(node);
  }
  return top;
}

/** A failed index read becomes an empty library, logged, so the panel stays usable. */
async function readPapers(deps: ListPanelDeps): Promise<PaperRecord[]> {
  try {
    return await deps.paperService.listPapers();
  } catch (error) {
    await deps.logger.log('WARN', LOG_MODULE, 'Index could not be read for the list', { message: String(error) });
    return [];
  }
}

export async function readSnapshot(deps: ListPanelDeps, paths: LibraryPaths): Promise<LibraryUiSnapshot> {
  const records = await readPapers(deps);
  const papers: PaperRecord[] = [];
  for (const record of records) {
    const ui = paths.toUi(record.path);
    if (ui) { papers.push({ ...record, path: ui }); }
  }
  const [folders, stats] = await Promise.all([folderTree(deps, paths), deps.loadSidecar ? createSidecarReader(deps.loadSidecar, deps.logger, LOG_MODULE).statsOf(records) : {}]);
  // A record says nothing about its PDF until the indexer has looked; that counts as present.
  const pdfDirs = papers.filter((p) => p.hasPdf !== false).map((p) => p.path);
  return { folders, papers, pdfDirs, stats };
}
