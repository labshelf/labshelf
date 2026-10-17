// Finds sync-tool conflict copies in a library: merges sidecar copies and lists the rest for the user.
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { METADATA_FILE, PAPERS_DIR } from "../../layout.js";
import type { ConflictCopy } from "../conflictCopy.js";
import { parseConflictName } from "../conflictNames.js";
import { readDirOrEmpty } from "./readDirOrEmpty.js";
import { mergeSidecarConflicts } from "./sidecarConflictMerge.js";

/** Collects conflict copies under `dir`; a file belongs to the nearest enclosing paper folder, and hidden names are skipped. */
async function collectPaperConflicts(dir: string, paperId: string | null, found: ConflictCopy[]): Promise<void> {
  const entries = (await readDirOrEmpty(dir)).filter((entry) => !entry.name.startsWith("."));
  const owner = entries.some((entry) => entry.isFile() && entry.name === METADATA_FILE) ? path.basename(dir) : paperId;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectPaperConflicts(full, owner, found);
      continue;
    }
    const parsed = entry.isFile() && owner ? parseConflictName(entry.name) : null;
    if (parsed && owner) { found.push({ owner: { kind: "paper", id: owner }, original: path.join(dir, parsed.original), copy: full, tool: parsed.tool }); }
  }
}

/**
 * Scans a library root: merges every sidecar conflict copy into data.json, then lists the conflict copies
 * inside paper folders (and any sidecar copy that could not be merged) for the user to resolve.
 * @returns the unresolved conflict copies, sorted by copy path.
 */
export async function scanConflictCopies(root: string, logger: ILogger): Promise<ConflictCopy[]> {
  const found = await mergeSidecarConflicts(root, logger);
  await collectPaperConflicts(path.join(root, PAPERS_DIR), null, found);
  if (found.length > 0) { void logger.log("INFO", "conflicts", "Found sync conflict copies", { root, count: found.length }); }
  return found.sort((a, b) => a.copy.localeCompare(b.copy));
}
