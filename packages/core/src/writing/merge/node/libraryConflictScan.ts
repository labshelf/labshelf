// Scans a whole library for sync conflict copies: paper folders, sidecars, Spaces and writing projects.
import type { ConflictCopy } from "../../../library/conflicts/index.js";
import { scanConflictCopies, scanSpaceConflicts } from "../../../library/conflicts/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { IProjectVersionStore } from "../index.js";
import { mergePaperNotesConflicts, mergeSpaceItemFileConflicts } from "./itemFiles/index.js";
import { scanProjectConflicts, scanSharedProjectConflicts } from "./projectConflictScan.js";

/** The last scan queued per library root. */
const queued = new Map<string, Promise<unknown>>();

async function scan(root: string, store: IProjectVersionStore, logger: ILogger, onMerged: (file: string) => void): Promise<ConflictCopy[]> {
  const papers = [...await scanConflictCopies(root, logger), ...await mergePaperNotesConflicts(root, store, logger)];
  const projects = await scanProjectConflicts(root, store, logger, onMerged);
  const shared = await scanSharedProjectConflicts(root, store, logger);
  const spaces = [...await scanSpaceConflicts(root, logger), ...await mergeSpaceItemFileConflicts(root, store, logger)];
  return [...papers, ...spaces, ...projects, ...shared].sort((a, b) => a.copy.localeCompare(b.copy));
}

/**
 * Scans run one at a time per library: a scan writes files, and two at once would merge one copy twice.
 * @returns the conflict copies left for the user, sorted by copy path.
 */
export function scanLibraryConflicts(root: string, store: IProjectVersionStore, logger: ILogger, onMerged: (file: string) => void = () => {}): Promise<ConflictCopy[]> {
  const run = (queued.get(root) ?? Promise.resolve()).catch(() => undefined).then(() => scan(root, store, logger, onMerged));
  queued.set(root, run);
  void run.finally(() => { if (queued.get(root) === run) { queued.delete(root); } }).catch(() => undefined);
  return run;
}
