// Reads project checklist progress for the Spaces host.
import { buildChecklist, readChecklistSignals, type ProjectRow, type Progress } from "@labshelf/core";
import type { WritingViewHandles } from "../activation/registration/index.js";

export async function projectChecklist(writing: WritingViewHandles, row: ProjectRow): Promise<Progress | undefined> {
  const project = writing.projects.list().find(entry => entry.folder === row.id);
  if (project?.kind !== "ready") { return undefined; }
  const [signals, list] = await Promise.all([
    readChecklistSignals(writing.projects.reads(writing.logger), project), writing.readingLists.of(project),
  ]);
  const reading = list.entries.flatMap(({ key, paper }) => paper ? [{ key, title: paper.title, status: paper.status }] : []);
  const checklist = buildChecklist({ ...signals, reading, pageOverflow: undefined,
    placeSection: file => ({ id: file, title: file, file }), citeSections: new Map(),
  }, "kind");
  const items = checklist.groups.flatMap(group => group.items);
  return { done: items.filter(item => item.done).length, total: items.length };
}
