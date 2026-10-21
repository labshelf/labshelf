// Decides how a source tab opens a project file: local, bound to its share's text, observing a share another tab runs, or unresolved.
import { fileText, type ILogger, type ProjectEntry } from "@labshelf/core";
import type { PageSharing } from "../../editor/collab";
import type { SourceEditorDeps } from "../../editor/index.js";

const MODULE = "tabs.source";

/** `observing` and `unresolved` keep a shared file out of local edits: a write outside the share would never reach the collaborators. */
export type SourceFileMode =
  | { kind: "local" }
  | { kind: "shared"; collab: NonNullable<SourceEditorDeps["collab"]> }
  | { kind: "observing"; shareId: string }
  | { kind: "unresolved" };

/** `retried`: the user asked to try again, which reconnects the share from its stored key. */
export async function sourceFileMode(sharing: Pick<PageSharing, "liveShare" | "shares">, entry: ProjectEntry, path: string, logger: ILogger, retried: boolean): Promise<SourceFileMode> {
  if (entry.kind !== "ready" || entry.settings.shared === undefined) return { kind: "local" };
  const context = { projectId: entry.settings.id, shareId: entry.settings.shared, path, note: "the file opens read-only until the share connects in this tab" };
  try {
    const live = await sharing.liveShare(entry, retried);
    if (live) return { kind: "shared", collab: { text: fileText(live.session.openDoc(path)), presence: live.presence, name: sharing.shares.name() } };
    void logger.log("WARN", MODULE, "A shared file opened while its share is not connected in this tab", context);
  } catch (error) {
    void logger.error(MODULE, error, { action: "connect the share of a source file", ...context });
  }
  // CONTRACT: documents/contracts/collaboration.md#mirror-ownership
  if (sharing.shares.state(entry.settings.shared)?.kind === "observer") return { kind: "observing", shareId: entry.settings.shared };
  return { kind: "unresolved" };
}
