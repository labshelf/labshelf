/** Checks the paths and sizes of a template's files against the rules every app and the catalog CI share. */
// CONTRACT: documents/contracts/templates.md#paths

const MAX_PATH_LENGTH = 255;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
// INVARIANT: lowercase, because segments are compared case-insensitively.
const FORBIDDEN_SEGMENTS = new Set(["latexmkrc", ".latexmkrc", ".git"]);
// A control character in a path is the whole point of this check.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/** The reason a path is unsafe inside a template, or undefined when it is safe. */
export function templatePathProblem(path: string): string | undefined {
  const refuse = (why: string) => `"${path}" ${why}`;
  if (path.length > MAX_PATH_LENGTH) { return refuse(`is longer than ${MAX_PATH_LENGTH} characters`); }
  if (path.includes("\\")) { return refuse("contains a backslash"); }
  if (DRIVE_LETTER.test(path)) { return refuse("starts with a drive letter"); }
  if (CONTROL_CHARACTER.test(path)) { return refuse("contains a control character"); }
  for (const segment of path.split("/")) {
    if (segment === "") { return refuse("has an empty segment"); }
    if (segment === "." || segment === "..") { return refuse(`has a "${segment}" segment`); }
    if (FORBIDDEN_SEGMENTS.has(segment.toLowerCase())) { return refuse(`has a forbidden "${segment}" segment`); }
  }
  return undefined;
}

/** The first rule a template's file list breaks (paths, labshelf.yaml, case clashes, counts and sizes), or undefined. */
export function templateTreeProblem(files: readonly { path: string; size: number }[]): string | undefined {
  if (files.length > MAX_FILES) { return `${files.length} files; at most ${MAX_FILES} are allowed`; }
  const seen = new Set<string>();
  let total = 0;
  for (const { path, size } of files) {
    const problem = templatePathProblem(path);
    if (problem !== undefined) { return problem; }
    const folded = path.toLowerCase();
    if (folded === "labshelf.yaml") { return `"${path}" would replace the project's labshelf.yaml`; }
    if (seen.has(folded)) { return `"${path}" differs from another path only in case`; }
    seen.add(folded);
    if (size > MAX_FILE_BYTES) { return `"${path}" is over ${MAX_FILE_BYTES / 1024 / 1024} MiB`; }
    total += size;
  }
  return total > MAX_TOTAL_BYTES ? `the files total over ${MAX_TOTAL_BYTES / 1024 / 1024} MiB` : undefined;
}
