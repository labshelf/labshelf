/** Resolves the per-user cache directory every LabShelf app shares, following XDG on every Unix.
 * $XDG_CACHE_HOME/labshelf (default ~/Library/Caches/labshelf on macOS, ~/.cache/labshelf elsewhere). */
import * as os from "node:os";
import * as path from "node:path";

export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["XDG_CACHE_HOME"]) { return path.join(env["XDG_CACHE_HOME"], "labshelf"); }
  if (process.platform === "darwin") { return path.join(os.homedir(), "Library", "Caches", "labshelf"); }
  return path.join(os.homedir(), ".cache", "labshelf");
}
