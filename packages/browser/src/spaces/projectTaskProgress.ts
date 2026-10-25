// Reads browser project checklist progress for the Spaces host.
import {
  spaceChecklistProgress, papersByCiteKey, posixPathOps, readChecklistSignals,
  type ILogger, type LibraryFileSystem, type LibraryPapers, type Progress, type ProjectEntry,
} from '@labshelf/core';

export async function projectChecklist(fs: LibraryFileSystem, logger: ILogger, entry: Extract<ProjectEntry, { kind: 'ready' }>, library: LibraryPapers): Promise<Progress | undefined> {
  const signals = await readChecklistSignals({ fs, logger, paths: posixPathOps }, entry);
  const papers = papersByCiteKey([...library.values()].map(value => value.record));
  const reading = (entry.settings.papers ?? []).flatMap(({ key }) => {
    const paper = papers.get(key);
    return paper ? [{ key, title: paper.title, status: paper.status }] : [];
  });
  return spaceChecklistProgress(signals, reading);
}
