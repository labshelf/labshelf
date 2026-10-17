// Decides which paths of a writing project the sync leaves alone.
// CONTRACT: documents/contracts/sync.md#projects
import { matchesInputPattern } from "../../../writing/figures/index.js";
import { isSafeFolderName } from "../naming/index.js";

// Projects may hold a per-device cursor file; it never syncs.
const STATE_FILE = ".labshelf/state.json";
const VERSIONS_DIR = [".labshelf", "versions"];

function inVersionBuild(segments: string[]): boolean {
  return segments.length > 3
    && VERSIONS_DIR.every((name, index) => segments[index] === name)
    && segments[2]!.startsWith(".");
}

/**
 * Whether a path relative to the project folder is left out of the sync: the project's git repository, one device's
 * cursor, a version being written, a path the project's `ignore:` patterns match (or lie under), and a name that
 * would leave the project folder when written locally.
 */
export function isIgnoredProjectPath(path: string, patterns: readonly string[]): boolean {
  const segments = path.split("/");
  if (segments.includes(".git") || path === STATE_FILE || inVersionBuild(segments)) { return true; }
  // TRAP: Drive accepts names such as ".." and "a/b", which would resolve outside the project folder.
  if (segments.some((segment) => !isSafeFolderName(segment))) { return true; }
  return segments.some((_, index) => {
    const ancestor = segments.slice(0, index + 1).join("/");
    return patterns.some((pattern) => matchesInputPattern(pattern, ancestor));
  });
}
