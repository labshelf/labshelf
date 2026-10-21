// Reads browser project checklist progress for the Spaces host.
import {
  buildChecklist, papersByCiteKey, posixPathOps, readChecklistSignals,
  type ILogger, type LibraryFileSystem, type LibraryPapers, type Progress, type ProjectEntry,
} from '@labshelf/core';

export async function projectChecklist(fs: LibraryFileSystem, logger: ILogger, entry: Extract<ProjectEntry, { kind: 'ready' }>, library: LibraryPapers): Promise<Progress | undefined> {
  const signals = await readChecklistSignals({ fs, logger, paths: posixPathOps }, entry);
  const papers = papersByCiteKey([...library.values()].map(value => value.record));
  const reading = (entry.settings.papers ?? []).flatMap(({ key }) => {
    const paper = papers.get(key);
    return paper ? [{ key, title: paper.title, status: paper.status }] : [];
  });
  const checklist = buildChecklist({
    ...signals, reading, pageOverflow: undefined,
    placeSection: file => ({ id: file, title: file, file }), citeSections: new Map(),
  }, 'kind');
  const items = checklist.groups.flatMap(group => group.items);
  return { done: items.filter(item => item.done).length, total: items.length };
}
