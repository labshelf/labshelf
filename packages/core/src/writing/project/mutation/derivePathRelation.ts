// Tells whether a path is a folder itself, inside it or outside it, with the host's path arithmetic.
import type { PathOps } from "../../../library/index.js";

export function derivePathRelation(paths: PathOps, folder: string, target: string): "same" | "inside" | "outside" {
  const relative = paths.relative(paths.resolve(folder), paths.resolve(target));
  if (relative === "") { return "same"; }
  return relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative) ? "outside" : "inside";
}
