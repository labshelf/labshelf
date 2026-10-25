// Resolves the folder where the helper keeps its build working copies and logs; the managed TeX lives in the shared TeX folder.
import * as path from "node:path";

// CONTRACT: documents/contracts/helper.md#data-folder
export function helperDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string {
  if (platform === "darwin") { return path.join(homeDir, "Library", "Application Support", "LabShelf Helper"); }
  if (platform === "win32") { return path.join(env["LOCALAPPDATA"] ?? path.join(homeDir, "AppData", "Local"), "LabShelf Helper"); }
  return path.join(env["XDG_DATA_HOME"] || path.join(homeDir, ".local", "share"), "labshelf-helper");
}
