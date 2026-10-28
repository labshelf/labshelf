/** Implements isInside, the one test of whether a path lies inside a folder, and the folder-relative path built on it, over the PathOps port. */
import type { PathOps } from "./pathOps.js";

/** Whether `file` lies inside `folder`: a child named `..notes` is inside, a file on another drive is outside, and `folder` itself counts only with `allowEqual`. */
export function isInside(paths: PathOps, folder: string, file: string, options?: { allowEqual?: boolean }): boolean {
  const relative = paths.relative(folder, file);
  if (relative === "") { return options?.allowEqual === true; }
  return relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}

/** A `/`-separated path relative to `folder`; a file outside the folder keeps its own path. */
export function deriveProjectPath(paths: PathOps, folder: string, file: string): string {
  return (isInside(paths, folder, file, { allowEqual: true }) ? paths.relative(folder, file) : file).split(paths.sep).join("/");
}
