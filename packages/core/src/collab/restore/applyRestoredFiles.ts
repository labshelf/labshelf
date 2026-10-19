// Writes the files a history restore put on disk into the share's docs and index, so peers receive the restored version.
import type { ILogger } from "../../ports/index.js";
import { fileText, replaceFileText } from "../model/fileText.js";
import { isSafeSharePath } from "../model/safeSharePath.js";
import { indexFiles } from "../model/shareIndex.js";
import type { ShareSession } from "../sync/index.js";

const LOG_MODULE = "collab.restore";

export interface ApplyRestoredFilesOptions {
  session: Pick<ShareSession, "index" | "openDoc">;
  /** The text a shared path holds after the restore, or null when the restore removed the file. */
  restored(path: string): Promise<string | null>;
  /** The transaction origin of the edits; not the disk origin, which the node mirror skips and so would never send to peers. */
  origin: unknown;
  logger: ILogger;
}

export async function applyRestoredFiles({ session, restored, origin, logger }: ApplyRestoredFilesOptions): Promise<void> {
  const files = indexFiles(session.index);
  const textPaths = [...files.entries()].filter(([path, entry]) => entry.kind === "text" && isSafeSharePath(path)).map(([path]) => path);
  const removed: string[] = [];
  let updated = 0;
  for (const path of textPaths) {
    const next = await restored(path);
    if (next === null) { removed.push(path); continue; }
    const doc = session.openDoc(path);
    if (fileText(doc).toString() === next) { continue; }
    replaceFileText(doc, next, origin);
    updated += 1;
  }
  if (removed.length > 0) {
    session.index.transact(() => { for (const path of removed) { files.delete(path); } }, origin);
  }
  void logger.log("INFO", LOG_MODULE, "Applied a history restore to the shared project", { updated, removed: removed.length });
}
