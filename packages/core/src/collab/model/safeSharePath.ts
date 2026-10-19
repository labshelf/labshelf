// Decides whether a file path listed by a peer is safe to write below a project folder.
import { PROJECT_FILE } from "../../writing/project/index.js";
import { SHARED_TOOL_FILES } from "./sharedPaths.js";

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const TOOL_FOLDER = ".labshelf";

/**
 * True for a relative POSIX path that stays inside the folder on every platform: no empty, `.` or `..` segment,
 * no backslash, colon (drive letter, NTFS stream) or NUL, no Windows device name, no trailing dot or space. The project
 * file and the tool folder are reserved in any letter case, which a case-insensitive disk folds together, except for
 * the tool files a share holds.
 */
export function isSafeSharePath(path: string): boolean {
  if (typeof path !== "string" || path === "" || /[\\:\0]/.test(path)) { return false; }
  const segments = path.split("/");
  const plain = segments.every((segment) =>
    segment !== "" && segment !== "." && segment !== ".." && !/[. ]$/.test(segment) && !WINDOWS_DEVICE.test(segment));
  if (!plain || path.toLowerCase() === PROJECT_FILE) { return false; }
  return segments[0]!.toLowerCase() !== TOOL_FOLDER || SHARED_TOOL_FILES.includes(path);
}
