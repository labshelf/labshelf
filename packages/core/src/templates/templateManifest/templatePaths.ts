/** Checks the paths and sizes of a template's files against the rules every app and the catalog CI share. */
// CONTRACT: documents/contracts/templates.md#paths
import { checkRelativePath } from "../../path/index.js";

const MAX_PATH_LENGTH = 255;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
// INVARIANT: lowercase, because segments are compared case-insensitively.
const FORBIDDEN_SEGMENTS = new Set(["latexmkrc", ".latexmkrc", ".git"]);

/** The reason a path is unsafe inside a template, or undefined when it is safe. */
export function deriveTemplatePathProblem(path: string): string | undefined {
  const refuse = (why: string) => `"${path}" ${why}`;
  if (path.length > MAX_PATH_LENGTH) { return refuse(`is longer than ${MAX_PATH_LENGTH} characters`); }
  const problem = checkRelativePath(path);
  if (problem !== undefined) { return refuse(problem); }
  const forbidden = path.split("/").find((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()));
  return forbidden === undefined ? undefined : refuse(`has a forbidden "${forbidden}" segment`);
}

/** The first path rule a template's file list breaks (paths, labshelf.yaml, case clashes, file count), or undefined. */
export function deriveTemplateStructureProblem(files: readonly { path: string }[]): string | undefined {
  if (files.length > MAX_FILES) { return `${files.length} files; at most ${MAX_FILES} are allowed`; }
  const seen = new Set<string>();
  for (const { path } of files) {
    const problem = deriveTemplatePathProblem(path);
    if (problem !== undefined) { return problem; }
    const folded = path.toLowerCase();
    if (folded === "labshelf.yaml") { return `"${path}" would replace the project's labshelf.yaml`; }
    if (seen.has(folded)) { return `"${path}" differs from another path only in case`; }
    seen.add(folded);
  }
  return undefined;
}

/** The first size rule a template's file list breaks (one file or the total too large), or undefined. */
export function deriveTemplateSizeProblem(files: readonly { path: string; size: number }[]): string | undefined {
  let total = 0;
  for (const { path, size } of files) {
    if (size > MAX_FILE_BYTES) { return `"${path}" is over ${MAX_FILE_BYTES / 1024 / 1024} MiB`; }
    total += size;
  }
  return total > MAX_TOTAL_BYTES ? `the files total over ${MAX_TOTAL_BYTES / 1024 / 1024} MiB` : undefined;
}

/** The first rule a template's file list breaks, paths before sizes, or undefined. */
export function deriveTemplateTreeProblem(files: readonly { path: string; size: number }[]): string | undefined {
  return deriveTemplateStructureProblem(files) ?? deriveTemplateSizeProblem(files);
}
