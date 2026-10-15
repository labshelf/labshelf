/** Decides whether a sync changed the local library, so an app re-reads its papers only when it has to. */
import type { SyncResult } from "../engine/index.js";

/**
 * True when the run pulled, removed or conflicted files in the `library` namespace. Uploads and appdata-only changes
 * leave the papers on disk as they were.
 * @returns true when the local library changed
 */
export function libraryChanged(result: SyncResult): boolean {
  return result.namespaces.some(
    (ns) => ns.namespace === "library" && (ns.downloaded > 0 || ns.deletedLocal > 0 || ns.conflicts.length > 0),
  );
}
