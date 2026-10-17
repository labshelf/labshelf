// Describes a sync tool's conflict copy of a library file and the ways the user can resolve it.
import { METADATA_FILE } from "../layout.js";

export type SyncTool = "syncthing" | "nextcloud" | "dropbox" | "rclone";

export interface ConflictCopy {
  /** The paper the file belongs to: its paper folder, or its sidecar folder. */
  paperId: string;
  /** Absolute path of the file the copy conflicts with; it may be missing. */
  original: string;
  /** Absolute path of the conflict copy. */
  copy: string;
  tool: SyncTool;
}

/** keepMine deletes the copy, keepOther replaces the original with it, keepBoth keeps it as `<name> (copy N).<ext>`. */
export type ConflictResolution = "keepMine" | "keepOther" | "keepBoth";

/** The resolutions a copy allows: keepBoth is left out for metadata.yaml, because a paper has exactly one. */
export function conflictResolutions(conflict: ConflictCopy): ConflictResolution[] {
  const fileName = conflict.original.split(/[\\/]/).pop();
  return fileName === METADATA_FILE ? ["keepMine", "keepOther"] : ["keepMine", "keepOther", "keepBoth"];
}
