// Maps shared conflict choices to VS Code quick-pick items.
import { conflictPromptChoices, type ConflictCopy, type ConflictPromptResolution, type SyncTool } from "@labshelf/core";

const TOOL_NAMES: Record<SyncTool, string> = {
  syncthing: "Syncthing",
  nextcloud: "Nextcloud",
  dropbox: "Dropbox",
  rclone: "rclone",
  app: "LabShelf",
  unknown: "unknown",
};

export interface ConflictChoice {
  label: string;
  resolution: ConflictPromptResolution;
}

export function conflictChoices(copy: ConflictCopy): ConflictChoice[] {
  return conflictPromptChoices(copy);
}

export function toolName(tool: SyncTool): string {
  return TOOL_NAMES[tool];
}
