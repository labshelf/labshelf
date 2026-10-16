/** Traces text seen in the PDF back to the source line that wrote it, ignoring comments, which never reach the PDF. */
import type { CheckSource } from "./checkTypes.js";

/** TRAP: a Typst `//` comment must not swallow the `//` of a URL, which Typst reads as a link. */
const TYPST_COMMENT = /(^|[^:])\/\/.*$/;
const LATEX_COMMENT = /(^|[^\\])%.*$/;

function withoutComment(line: string, file: string): string {
  return line.replace(file.endsWith(".typ") ? TYPST_COMMENT : LATEX_COMMENT, "$1");
}

/** The first source line whose text outside comments matches; `pattern` must not be global, so `test` keeps no state. */
export function locateInSources(pattern: RegExp, sources: CheckSource[]): { file: string; line: number } | undefined {
  for (const source of sources) {
    const index = source.lines.findIndex((line) => pattern.test(withoutComment(line, source.file)));
    if (index >= 0) { return { file: source.file, line: index + 1 }; }
  }
  return undefined;
}
