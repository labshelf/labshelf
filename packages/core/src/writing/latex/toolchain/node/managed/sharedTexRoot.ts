// Resolves the per-user folder where every LabShelf app keeps the one managed TeX.
import * as path from "node:path";

// CONTRACT: documents/contracts/managed-tex.md#folder
export function sharedTexRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string {
  if (platform === "darwin") { return path.join(homeDir, "Library", "Application Support", "LabShelf", "tex"); }
  if (platform === "win32") { return path.join(env["LOCALAPPDATA"] || path.join(homeDir, "AppData", "Local"), "LabShelf", "tex"); }
  return path.join(env["XDG_DATA_HOME"] || path.join(homeDir, ".local", "share"), "labshelf", "tex");
}
