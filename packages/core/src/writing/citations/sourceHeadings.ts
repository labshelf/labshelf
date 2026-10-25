/** Finds the headings of a LaTeX or Typst source with the line each starts on. */
import { scanLatexSource } from "../../latex/index.js";
import type { ProjectFormat } from "../project/index.js";
import { scanTypstHeadings } from "../../typst/language/syntax/index.js";

export interface SourceHeading {
  /** Zero-based line of the heading. */
  line: number;
  title: string;
}

/** Headings in text order. */
export function sourceHeadings(format: ProjectFormat, text: string): SourceHeading[] {
  if (format === "typst") { return scanTypstHeadings(text).map(({ line, title }) => ({ line, title })); }
  return scanLatexSource(text).sections.map((section) => ({ line: section.range.start.line, title: section.title }));
}
