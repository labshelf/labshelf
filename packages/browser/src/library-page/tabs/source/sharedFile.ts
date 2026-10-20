// Decides how a source tab opens a project file: local, bound to its share's text, or unresolved when the share cannot start.
import { fileText, type ILogger, type ProjectEntry } from "@labshelf/core";
import type { PageShares } from "../../editor/collab";
import type { SourceEditorDeps } from "../../editor/index.js";

const MODULE = "tabs.source";

/** `unresolved` keeps a shared file out of local edits: a write outside the share would never reach the collaborators. */
export type SourceFileMode =
  | { kind: "local" }
  | { kind: "shared"; collab: NonNullable<SourceEditorDeps["collab"]> }
  | { kind: "unresolved" };

export async function sourceFileMode(shares: PageShares, entry: ProjectEntry, path: string, logger: ILogger): Promise<SourceFileMode> {
  if (entry.kind !== "ready" || entry.settings.shared === undefined) return { kind: "local" };
  const projectId = entry.settings.id;
  try {
    await shares.connect(projectId, entry.settings.shared, entry.folder);
    const active = shares.active(projectId);
    if (!active) throw new Error(`The share of project ${projectId} is not connected in this tab`);
    return { kind: "shared", collab: { text: fileText(active.session.openDoc(path)), presence: active.presence, name: shares.name() } };
  } catch (error) {
    void logger.error(MODULE, error, { action: "joinSharedSession", projectId, path, note: "the file opens read-only until the session starts" });
    return { kind: "unresolved" };
  }
}
