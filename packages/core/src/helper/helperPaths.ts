/** Checks that a project path or project id is safe to resolve inside the helper's data folder. */
// CONTRACT: documents/contracts/helper.md#messages

import { MAX_PATH_LENGTH } from "./helperMessages.js";

// INVARIANT: matches what deriveProjectIdSlug produces, so every id LabShelf derives passes and none can name a parent folder.
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/** The reason a relative POSIX project path is refused, or undefined when it is safe. */
export function checkHelperPath(path: string): string | undefined {
  if (path === "") { return "path is empty"; }
  if (path.length > MAX_PATH_LENGTH) { return `path is longer than ${MAX_PATH_LENGTH} characters`; }
  if (path.includes("\u0000")) { return "path contains NUL"; }
  if (path.includes("\\")) { return "path contains a backslash"; }
  if (path.startsWith("/")) { return "path is absolute"; }
  if (DRIVE_LETTER.test(path)) { return "path starts with a drive letter"; }
  for (const segment of path.split("/")) {
    if (segment === "") { return "path has an empty segment"; }
    if (segment === "." || segment === "..") { return `path has a ${segment} segment`; }
  }
  return undefined;
}

export function isHelperProjectId(id: string): boolean {
  return PROJECT_ID.test(id);
}
