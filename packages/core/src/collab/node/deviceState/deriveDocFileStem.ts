// Names a doc's stored state files by the doc id the wire uses, so the state dir never holds file paths.
import { createHash } from "node:crypto";

// CONTRACT: documents/contracts/collaboration.md#messages
/** The doc id in hex, computed synchronously because a share session creates docs synchronously. */
export function deriveDocFileStem(shareId: string, docKey: string): string {
  return createHash("sha256").update(`${shareId}\0${docKey}`).digest("hex").slice(0, 32);
}
