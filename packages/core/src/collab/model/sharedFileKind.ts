/** Decides whether a shared file is a text doc or a blob. */

import { isMergeableTextFile } from "../../writing/conflict/index.js";
import type { ShareFileEntry } from "./shareIndexDoc.js";

/** A file with a text extension and valid UTF-8 is a text doc; anything else would be corrupted by character edits. */
export function sharedFileKind(path: string, bytes: Uint8Array): ShareFileEntry["kind"] {
  return isMergeableTextFile(path, bytes) ? "text" : "blob";
}
