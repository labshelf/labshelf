// Lists the choices offered for a conflict copy, with the labels the quick pick shows.
import { conflictResolutions, type ConflictCopy, type ConflictResolution, type SyncTool } from "@labshelf/core";

const LABELS: Record<ConflictResolution, string> = {
  keepMine: "Keep mine",
  keepOther: "Keep the other",
  keepBoth: "Keep both",
};

const TOOL_NAMES: Record<SyncTool, string> = {
  syncthing: "Syncthing",
  nextcloud: "Nextcloud",
  dropbox: "Dropbox",
  rclone: "rclone",
  app: "LabShelf",
};

export interface ConflictChoice {
  label: string;
  resolution: ConflictResolution;
}

export function conflictChoices(copy: ConflictCopy): ConflictChoice[] {
  return conflictResolutions(copy).map((resolution) => ({ label: LABELS[resolution], resolution }));
}

export function toolName(tool: SyncTool): string {
  return TOOL_NAMES[tool];
}
