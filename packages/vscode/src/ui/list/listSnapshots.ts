/**
 * Reads the library as the list UI renders it: every paper record with its path in UI form, the folder tree, which
 * papers have their PDF here, and each paper's reading stats from its sidecar.
 */
import { createSidecarReader, folderTreeFromSnapshot, type LibraryUiSnapshot, type PaperRecord } from '@labshelf/core';
import type { LibraryPaths } from './libraryPaths.js';
import type { ListPanelDeps } from './listPanelDeps.js';

const LOG_MODULE = 'ui/list/listSnapshots';

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
  const stats = deps.loadSidecar ? await createSidecarReader(deps.loadSidecar, deps.logger, LOG_MODULE).statsOf(records) : {};
  const folders = folderTreeFromSnapshot(deps.getSnapshot());
  // A record says nothing about its PDF until the indexer has looked; that counts as present.
  const pdfDirs = papers.filter((p) => p.hasPdf !== false).map((p) => p.path);
  return { folders, papers, pdfDirs, stats };
}
