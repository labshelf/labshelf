// Describes a sync tool's conflict copy of a library file and the ways the user can resolve it.
import { METADATA_FILE, PAPER_NOTES_FILE } from "../layout.js";

export type SyncTool = "syncthing" | "nextcloud" | "dropbox" | "rclone" | "app" | "unknown";

/** A paper (its paper folder or its sidecar folder), a writing project or a Space, by id. */
export type ConflictOwner = { kind: "paper"; id: string } | { kind: "project"; id: string } | { kind: "space"; id: string };

export interface ConflictCopy {
  owner: ConflictOwner;
  /** Absolute path of the file the copy conflicts with; it may be missing. */
  original: string;
  /** Absolute path of the conflict copy. */
  copy: string;
  tool: SyncTool;
  match?: "name" | "record" | "similar";
}

/** keepMine deletes the copy, keepOther replaces the original with it, keepBoth keeps it as `<name> (copy N).<ext>`. */
export type ConflictResolution = "keepMine" | "keepOther" | "keepBoth" | "mergeAutomatically" | "notAVersion";

/** The name a conflict is shown under: "Space <id>", the paper's title when known, else the owner id. */
export function formatConflictOwnerLabel(owner: ConflictOwner, paperTitle?: string): string {
  if (owner.kind === "space") return `Space ${owner.id}`;
  return (owner.kind === "paper" && paperTitle) || owner.id;
}

/** The resolutions a copy allows: keepBoth is left out for a paper's metadata.yaml and notes.qmd and for Space files, because a renamed copy of them is read by nothing. */
export function deriveConflictResolutions(conflict: ConflictCopy): ConflictResolution[] {
  if (conflict.match === "record" || conflict.match === "similar") return ["mergeAutomatically", "notAVersion"];
  const fileName = conflict.original.split(/[\\/]/).pop();
  const single = fileName === METADATA_FILE || (conflict.owner.kind === "paper" && fileName === PAPER_NOTES_FILE) || conflict.owner.kind === "space";
  return single ? ["keepMine", "keepOther"] : ["keepMine", "keepOther", "keepBoth"];
}
