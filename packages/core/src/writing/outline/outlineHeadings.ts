// Lists the headings of a LaTeX or Typst source with their level, so any host can nest them into an outline.
import { scanLatexSource } from "../../latex/index.js";
import type { ProjectFormat } from "../project/index.js";
import { scanTypstHeadings } from "../typst/source/index.js";

export interface OutlineHeading {
  /** Smaller is higher; LaTeX runs from part (-1) to subparagraph (5), Typst from 1. */
  level: number;
  title: string;
  /** Zero-based line of the heading. */
  line: number;
}

/** Headings in text order. */
export function outlineHeadings(format: ProjectFormat, text: string): OutlineHeading[] {
  if (format === "typst") { return scanTypstHeadings(text).map(({ level, title, line }) => ({ level, title, line })); }
  return scanLatexSource(text).sections.map((section) => ({ level: section.level, title: section.title, line: section.range.start.line }));
}
