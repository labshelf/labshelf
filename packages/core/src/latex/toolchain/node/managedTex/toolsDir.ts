// Resolves the per-user folder where every LabShelf app keeps its managed tools, one subfolder each.
import * as path from "node:path";

// CONTRACT: documents/contracts/managed-tools.md#folder
export function resolveSharedToolsDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string {
  if (platform === "darwin") { return path.join(homeDir, "Library", "Application Support", "LabShelf"); }
  if (platform === "win32") { return path.join(env["LOCALAPPDATA"] || path.join(homeDir, "AppData", "Local"), "LabShelf"); }
  return path.join(env["XDG_DATA_HOME"] || path.join(homeDir, ".local", "share"), "labshelf");
}
