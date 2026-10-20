// Describes a sync tool's conflict copy of a library file and the ways the user can resolve it.
import { METADATA_FILE } from "../layout.js";

export type SyncTool = "syncthing" | "nextcloud" | "dropbox" | "rclone";

/** A paper (its paper folder or its sidecar folder), a writing project or a Space, by id. */
export type ConflictOwner = { kind: "paper"; id: string } | { kind: "project"; id: string } | { kind: "space"; id: string };

export interface ConflictCopy {
  owner: ConflictOwner;
  /** Absolute path of the file the copy conflicts with; it may be missing. */
  original: string;
  /** Absolute path of the conflict copy. */
  copy: string;
  tool: SyncTool;
}

/** keepMine deletes the copy, keepOther replaces the original with it, keepBoth keeps it as `<name> (copy N).<ext>`. */
export type ConflictResolution = "keepMine" | "keepOther" | "keepBoth";

/** The name a conflict is shown under: "Space <id>", the paper's title when known, else the owner id. */
export function conflictOwnerLabel(owner: ConflictOwner, paperTitle?: string): string {
  if (owner.kind === "space") return `Space ${owner.id}`;
  return (owner.kind === "paper" && paperTitle) || owner.id;
}

/** The resolutions a copy allows: keepBoth is left out for metadata.yaml and the Space files space.json and glossary.json, because a paper has exactly one metadata.yaml and a Space exactly one of each. */
export function conflictResolutions(conflict: ConflictCopy): ConflictResolution[] {
  const fileName = conflict.original.split(/[\\/]/).pop();
  const single = fileName === METADATA_FILE || conflict.owner.kind === "space";
  return single ? ["keepMine", "keepOther"] : ["keepMine", "keepOther", "keepBoth"];
}
