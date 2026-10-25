/** Finds references whose label is defined nowhere in the project's scanned files. */
import type { ReferenceFact } from "../facts.js";
import type { ProjectSourceFile } from "./readLatexProjectSources.js";

export interface UndefinedReference {
  /** The file holding the reference. */
  path: string;
  ref: ReferenceFact;
}

// TRAP: a label that lives in an unscanned file, such as one pulled in by `\externaldocument`, is reported as undefined.
export function findUndefinedReferences(files: readonly ProjectSourceFile[]): UndefinedReference[] {
  const labels = new Set(files.flatMap((file) => file.facts.labels.map((label) => label.name)));
  return files.flatMap((file) => file.facts.refs.filter((ref) => !labels.has(ref.name)).map((ref) => ({ path: file.path, ref })));
}
