// Scans a whole library for sync conflict copies: paper folders, sidecars, Spaces and writing projects.
import type { ConflictCopy } from "../../../library/conflicts/index.js";
import { scanConflictCopies, scanSpaceConflicts } from "../../../library/conflicts/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { IMergeBaseStore } from "../mergeBaseStore.js";
import { scanProjectConflicts } from "./projectConflictScan.js";

/** The last scan queued per library root. */
const queued = new Map<string, Promise<unknown>>();

async function scan(root: string, store: IMergeBaseStore, logger: ILogger): Promise<ConflictCopy[]> {
  const papers = await scanConflictCopies(root, logger);
  const projects = await scanProjectConflicts(root, store, logger);
  const spaces = await scanSpaceConflicts(root, logger);
  return [...papers, ...spaces, ...projects].sort((a, b) => a.copy.localeCompare(b.copy));
}

/**
 * Scans run one at a time per library: a scan writes files, and two at once would merge one copy twice.
 * @returns the conflict copies left for the user, sorted by copy path.
 */
export function scanLibraryConflicts(root: string, store: IMergeBaseStore, logger: ILogger): Promise<ConflictCopy[]> {
  const run = (queued.get(root) ?? Promise.resolve()).catch(() => undefined).then(() => scan(root, store, logger));
  queued.set(root, run);
  void run.finally(() => { if (queued.get(root) === run) { queued.delete(root); } }).catch(() => undefined);
  return run;
}
