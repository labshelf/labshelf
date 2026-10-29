// Reconciles a shared .qmd file with its disk copy: disk edits become an item-level diff of the doc, doc edits are written as the serialized file.
import type { MirrorContext } from "../../collab/mirror/fileReconcile.js";
import type { MirrorFileRead } from "../../collab/mirror/mirrorFileSystem.js";
import type { ReconcileOutcome } from "../../collab/mirror/pathQueue.js";
import { QMD_ACCESS, reconcileDocText } from "../../collab/mirror/textMirror.js";

/** Same echo guard, merge and outcomes as a text doc; only reading and setting the doc's text differ. */
export function reconcileQmd(context: MirrorContext, path: string, disk: MirrorFileRead, settled: boolean): Promise<ReconcileOutcome> {
  return reconcileDocText(context, path, disk, settled, QMD_ACCESS);
}
