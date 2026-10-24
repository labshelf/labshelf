/** Moves the problems a section document reports onto the edited file's own lines. */

export interface SectionPlacement {
  /** Base name of the section document the engine compiled. */
  documentName: string;
  editedFile: string;
  /** Lines the section document holds above the section's first line. */
  headerLines: number;
  /** Zero-based line of the section's first line in the edited file. */
  startLine: number;
}

/** A problem on a header line has no source line, so it lands on the section's first line. */
export function mapSectionProblems<P extends { file?: string; line?: number }>(problems: readonly P[], place: SectionPlacement): P[] {
  return problems.map((problem) => {
    if (problem.file?.split(/[\\/]/).pop() !== place.documentName) { return problem; }
    const line = problem.line === undefined ? place.startLine + 1 : Math.max(problem.line - place.headerLines, 1) + place.startLine;
    return { ...problem, file: place.editedFile, line };
  });
}
