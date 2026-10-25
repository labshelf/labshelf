// Reads project checklist progress for the Spaces host.
import { spaceChecklistProgress, readChecklistSignals, type ProjectRow, type Progress } from "@labshelf/core";
import type { WritingViewHandles } from "../activation/index.js";

export async function projectChecklist(writing: WritingViewHandles, row: ProjectRow): Promise<Progress | undefined> {
  const project = writing.projects.list().find(entry => entry.folder === row.id);
  if (project?.kind !== "ready") { return undefined; }
  const [signals, list] = await Promise.all([
    readChecklistSignals(writing.projects.reads(writing.logger), project), writing.readingLists.of(project),
  ]);
  const reading = list.entries.flatMap(({ key, paper }) => paper ? [{ key, title: paper.title, status: paper.status }] : []);
  return spaceChecklistProgress(signals, reading);
}
