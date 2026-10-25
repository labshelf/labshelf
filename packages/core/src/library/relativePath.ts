/** Checks that a relative path stays inside the folder it is resolved against, on every platform. */

// A control character in a path is the whole point of this check.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/** Why a "/"-separated relative path could escape its folder or name another root, or undefined when it cannot. */
export function checkRelativePath(path: string): string | undefined {
  if (path.includes("\\")) { return "contains a backslash"; }
  if (DRIVE_LETTER.test(path)) { return "starts with a drive letter"; }
  if (path.startsWith("/")) { return "is absolute"; }
  if (CONTROL_CHARACTER.test(path)) { return "contains a control character"; }
  for (const segment of path.split("/")) {
    if (segment === "") { return "has an empty segment"; }
    if (segment === "." || segment === "..") { return `has a "${segment}" segment`; }
  }
  return undefined;
}
