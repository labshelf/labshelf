// Handles one batch of external library changes: scans conflict copies, then re-indexes.
import type { ILogger } from "../../ports/index.js";
import type { ConflictCopy } from "../conflicts/index.js";
import { formatError } from "../../logging/index.js";

const MODULE = "externalChange";

export interface ChangeBatchDeps {
  logger: ILogger;
  isRootPresent: () => Promise<boolean>;
  scanConflicts: () => Promise<ConflictCopy[]>;
  reindex: () => Promise<void>;
  /** Receives every scan's unresolved copies, including an empty list, so a host can clear its conflict UI. */
  onConflicts: (copies: ConflictCopy[]) => void;
}

// A conflict-scan failure must not block the re-index: the library still has to pick up the change.
export async function applyChangeBatch(deps: ChangeBatchDeps): Promise<void> {
  if (!(await deps.isRootPresent())) return;
  try {
    const copies = await deps.scanConflicts();
    await deps.logger.log("INFO", MODULE, "Conflict copies scanned", { unresolved: copies.length });
    deps.onConflicts(copies);
  } catch (error) {
    await deps.logger.log("WARN", MODULE, "Conflict scan failed", { message: formatError(error) });
  }
  await deps.reindex();
}
