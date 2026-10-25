/** Chooses the files of a project folder that a share holds. */

import { builtPdfPaths, isBuildOrToolPath, PROJECT_FILE } from "../../writing/project/index.js";

// The rest of .labshelf/ is device state or, for comments.json, written from the index doc's comments map.
export const SHARED_TOOL_FILES: readonly string[] = [".labshelf/checklist.json"];

/**
 * The paths (relative, POSIX) a share holds, in input order: what a project export holds plus labshelf.bib and
 * .labshelf/checklist.json. labshelf.yaml is left out because its shared keys travel as settings.
 */
export function deriveSharedPaths(list: readonly string[]): string[] {
  const builtPdfs = builtPdfPaths(list);
  return list.filter((path) =>
    path !== PROJECT_FILE && !builtPdfs.has(path) && (SHARED_TOOL_FILES.includes(path) || !isBuildOrToolPath(path)));
}
