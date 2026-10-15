/** Finds references whose label is defined nowhere in the project's scanned files. */
import type { RefFact } from "../facts.js";
import type { ProjectSourceFile } from "./collectProjectSources.js";

export interface UndefinedRef {
  /** The file holding the reference. */
  path: string;
  ref: RefFact;
}

// TRAP: a label that lives in an unscanned file, such as one pulled in by `\externaldocument`, is reported as undefined.
export function undefinedRefs(files: readonly ProjectSourceFile[]): UndefinedRef[] {
  const labels = new Set(files.flatMap((file) => file.facts.labels.map((label) => label.name)));
  return files.flatMap((file) => file.facts.refs.filter((ref) => !labels.has(ref.name)).map((ref) => ({ path: file.path, ref })));
}
