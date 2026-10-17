// Shortens a path under the home folder to the `~/…` form people recognise.
import * as path from "node:path";

export function displayPath(target: string, home: string): string {
  const relative = path.relative(home, target);
  if (relative === "") { return "~"; }
  if (relative.startsWith("..") || path.isAbsolute(relative)) { return target; }
  return `~/${relative.split(path.sep).join("/")}`;
}
