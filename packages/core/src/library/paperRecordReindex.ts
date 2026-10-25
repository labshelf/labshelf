// Re-indexes paper records when a collection folder is renamed, moved or deleted.
// The folder move itself stays in each app; only the record bookkeeping is shared.
import type { PaperRecord } from "../model/index.js";
import { isUnderDir } from "./model/index.js";

/** The index surface the reindexing needs, so the browser can pass a small adapter over its IndexedDB record store. */
export interface IPaperRecordCache {
  listPapers(): Promise<PaperRecord[]>;
  upsertPaper(paper: PaperRecord): Promise<void>;
  deletePaper(id: string): Promise<void>;
}

/** Upserts every paper under `oldDir` with its path re-rooted under `newDir` (paths are "/"-separated). */
export async function movePapersUnder(index: IPaperRecordCache, oldDir: string, newDir: string): Promise<void> {
  for (const paper of await index.listPapers()) {
    if (!isUnderDir(paper.path, oldDir, "/")) continue;
    await index.upsertPaper({ ...paper, path: newDir + paper.path.slice(oldDir.length) });
  }
}

/** Deletes every paper record whose stored path lies under `dirPath`. */
export async function removePapersUnder(index: IPaperRecordCache, dirPath: string): Promise<void> {
  for (const paper of await index.listPapers()) {
    if (isUnderDir(paper.path, dirPath, "/")) await index.deletePaper(paper.id);
  }
}
