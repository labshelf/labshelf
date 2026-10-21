// Tells the user once per episode that a connected share cannot store its edits on this device.
import type { ShareWorkflowPorts } from "../../../collab/share/workflows/index.js";
import { projectName } from "./projectShareStatus.js";

/** Where the user keeps LabShelf open: a VS Code window or a browser page. */
export type NoticePlace = "window" | "page";

/**
 * Returns the check to run after every change of the shares' state. An episode starts when a share's persistence
 * failure appears and ends when it clears, so a run of failed writes gives one notice.
 */
export function persistenceFailureNotices(
  ports: Pick<ShareWorkflowPorts, "shares" | "projects">, place: NoticePlace, notify: (message: string) => void,
): () => void {
  const failing = new Set<string>();
  return () => {
    const listed = new Set<string>();
    for (const share of ports.shares.list()) {
      listed.add(share.shareId);
      const failure = share.state().persistenceFailure;
      if (failure === undefined) { failing.delete(share.shareId); continue; }
      if (failing.has(share.shareId)) { continue; }
      failing.add(share.shareId);
      const entry = ports.projects.list().find((candidate) => candidate.folder === share.folder);
      const title = entry ? projectName(entry) : share.folder.split(/[\\/]/).filter(Boolean).pop() ?? share.folder;
      notify(`Edits to "${title}" cannot be stored on this device: ${failure}. Keep this ${place} open until it is fixed; `
        + "the other members still receive your edits while you are connected.");
    }
    for (const shareId of failing) { if (!listed.has(shareId)) { failing.delete(shareId); } }
  };
}
