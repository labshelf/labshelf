/** Implements isInside, the one test of whether a path lies inside a folder, over the PathOps port. */
import type { PathOps } from "./pathOps.js";

/** Whether `file` lies inside `folder`: a child named `..notes` is inside, a file on another drive is outside, and `folder` itself counts only with `allowEqual`. */
export function isInside(paths: PathOps, folder: string, file: string, options?: { allowEqual?: boolean }): boolean {
  const relative = paths.relative(folder, file);
  if (relative === "") { return options?.allowEqual === true; }
  return relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}
