/** Finds the headings of a LaTeX or Typst source with the line each starts on. */
import { scanLatexSource } from "../latex/index.js";
import type { ProjectFormat } from "../project/index.js";

export interface SourceHeading {
  /** Zero-based line of the heading. */
  line: number;
  title: string;
}

// `= Title`, `== Title <label>`; the label is not part of the title.
const TYPST_HEADING = /^[ \t]*=+[ \t]+(.+?)[ \t]*(?:<[\p{L}\p{N}_:.-]+>)?[ \t]*$/u;

function typstHeadings(text: string): SourceHeading[] {
  return text.split("\n").flatMap((line, index) => {
    const title = TYPST_HEADING.exec(line)?.[1];
    return title ? [{ line: index, title }] : [];
  });
}

/** Headings in text order. */
export function sourceHeadings(format: ProjectFormat, text: string): SourceHeading[] {
  if (format === "typst") { return typstHeadings(text); }
  return scanLatexSource(text).sections.map((section) => ({ line: section.range.start.line, title: section.title }));
}
