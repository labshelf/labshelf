/** Which files a manuscript's code listings may read: inside a workspace folder, or picked by the user on this machine; and the path a picked file is written with. */
// CONTRACT: documents/contracts/library-format.md#code-listings
import { isInside, type PathOps } from "../../path/index.js";

/** Where code may be read from: the open workspace folders and the files the user picked outside them, all absolute and normalised. */
export interface CodeFileAccess {
  workspaceFolders: readonly string[];
  picked: readonly string[];
}

/** A drive segment (`c:`) that a relative path keeps when the file is on another drive than the project. */
const DRIVE_SEGMENT = /^[A-Za-z]:$/;

/**
 * The absolute file a listing's path names from the project folder, or undefined when it may not be read: an absolute or
 * backslashed path, or a file outside every workspace folder that the user never picked.
 */
export function resolveCodeLinkFile(paths: PathOps, projectFolder: string, path: string, access: CodeFileAccess): string | undefined {
  if (path === "" || path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) { return undefined; }
  const file = paths.resolve(projectFolder, ...path.split("/"));
  if (access.workspaceFolders.some((folder) => isInside(paths, folder, file))) { return file; }
  return access.picked.includes(file) ? file : undefined;
}

/** The POSIX path of `file` relative to the project folder (`../analysis/fit.py`); undefined for a file on another drive, which no relative path reaches. */
export function deriveCodeLinkPath(paths: PathOps, projectFolder: string, file: string): string | undefined {
  const relative = paths.relative(projectFolder, file);
  if (relative === "" || paths.isAbsolute(relative)) { return undefined; }
  const segments = relative.split(paths.sep);
  return segments.some((segment) => DRIVE_SEGMENT.test(segment)) ? undefined : segments.join("/");
}
