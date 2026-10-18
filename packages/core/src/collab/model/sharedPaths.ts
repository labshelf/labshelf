/** Chooses the files of a project folder that a share holds. */

import { builtPdfPaths, isBuildOrToolPath, PROJECT_FILE } from "../../writing/project/index.js";

// The rest of .labshelf/ is device state; these two are the project's own and go to every member.
const SHARED_TOOL_FILES = new Set([".labshelf/checklist.json", ".labshelf/comments.json"]);

/**
 * The paths (relative, POSIX) a share holds, in input order: what a project export holds plus labshelf.bib and the
 * shared .labshelf files. labshelf.yaml is left out because its shared keys travel as settings.
 */
export function sharedPaths(list: readonly string[]): string[] {
  const builtPdfs = builtPdfPaths(list);
  return list.filter((path) =>
    path !== PROJECT_FILE && !builtPdfs.has(path) && (SHARED_TOOL_FILES.has(path) || !isBuildOrToolPath(path)));
}
