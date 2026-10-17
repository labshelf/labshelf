// Lists the files an entry of a project's history added, modified or deleted against the entry before it.
import type { HistoryEntry } from "./historyEntry.js";

export type FileChangeKind = "added" | "modified" | "deleted";

export interface FileChange {
  path: string;
  change: FileChangeKind;
}

/** Sorted by path; the first entry of a history has every file as added. */
export function entryChanges(before: HistoryEntry | undefined, entry: HistoryEntry): FileChange[] {
  const old = before?.files ?? {};
  const changes: FileChange[] = [];
  for (const [path, hash] of Object.entries(entry.files)) {
    if (!(path in old)) { changes.push({ path, change: "added" }); } else if (old[path] !== hash) { changes.push({ path, change: "modified" }); }
  }
  for (const path of Object.keys(old)) { if (!(path in entry.files)) { changes.push({ path, change: "deleted" }); } }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
