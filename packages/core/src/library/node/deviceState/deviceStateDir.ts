/** Resolves the per-user state directory every LabShelf app shares, following XDG on every Unix.
 * $XDG_STATE_HOME/labshelf (default ~/Library/Application Support/labshelf on macOS, ~/.local/state/labshelf elsewhere). */
import * as os from "node:os";
import * as path from "node:path";

/** An empty XDG_STATE_HOME counts as unset. */
export function stateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env["XDG_STATE_HOME"]) { return path.join(env["XDG_STATE_HOME"], "labshelf"); }
  if (platform === "darwin") { return path.join(os.homedir(), "Library", "Application Support", "labshelf"); }
  return path.join(os.homedir(), ".local", "state", "labshelf");
}
