// Keeps one entry per open project, keyed by the share it syncs through, for the comment and suggestion controllers.
import type { ProjectEntry } from "@labshelf/core";
import type { WritingProjects } from "../writing/index.js";
import type { CommentShare } from "./threads.js";

const isOpenProject = (entry: ProjectEntry): entry is Extract<ProjectEntry, { kind: "ready" }> => entry.kind === "ready" && !entry.settings.trashed;

/** Drops the entries of projects that are not open, then calls `create` for each open project whose entry is missing or keyed differently (its share changed). */
export function reconcileProjects(
  deps: { projects: Pick<WritingProjects, "list">; shares: { list(): readonly CommentShare[] } },
  entries: ReadonlyMap<string, { key: string }>,
  drop: (folder: string) => void,
  create: (folder: string, share: CommentShare | undefined, key: string) => void,
): void {
  const open = deps.projects.list().filter(isOpenProject);
  for (const folder of entries.keys()) {
    if (!open.some((project) => project.folder === folder)) { drop(folder); }
  }
  for (const { folder } of open) {
    const share = deps.shares.list().find((candidate) => candidate.folder === folder);
    const key = share ? `share:${share.shareId}` : "file";
    if (entries.get(folder)?.key === key) { continue; }
    drop(folder);
    create(folder, share, key);
  }
}
