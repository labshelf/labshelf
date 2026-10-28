// Lists the headings of a LaTeX or Typst source with their level, nests them into sections and finds the deepest section holding a position.
import { scanLatexSource } from "../../latex/index.js";
import type { ProjectFormat } from "../project/index.js";
import { scanTypstHeadings } from "../../typst/language/index.js";

export interface OutlineHeading {
  /** Smaller is higher; LaTeX runs from part (-1) to subparagraph (5), Typst from 1. */
  level: number;
  title: string;
  /** Zero-based line of the heading. */
  line: number;
}

/** Headings in text order. */
export function findOutlineHeadings(format: ProjectFormat, text: string): OutlineHeading[] {
  if (format === "typst") { return scanTypstHeadings(text).map(({ level, title, line }) => ({ level, title, line })); }
  return scanLatexSource(text).sections.map((section) => ({ level: section.level, title: section.title, line: section.range.start.line }));
}

/** A heading with the headings below it and the heading that ends its section. */
export interface HeadingNode<T extends { level: number }> {
  entry: T;
  /** The next heading of the same or a higher level; undefined when the section runs to the end of the file. */
  next: T | undefined;
  children: HeadingNode<T>[];
}

/** @param entries headings in text order; a smaller level is higher, and only the order between levels matters */
export function deriveNestedHeadings<T extends { level: number }>(entries: readonly T[]): HeadingNode<T>[] {
  const roots: HeadingNode<T>[] = [];
  const open: HeadingNode<T>[] = [];
  entries.forEach((entry, index) => {
    const node: HeadingNode<T> = { entry, next: entries.slice(index + 1).find((later) => later.level <= entry.level), children: [] };
    while (open.length > 0 && open[open.length - 1]!.entry.level >= entry.level) { open.pop(); }
    (open[open.length - 1]?.children ?? roots).push(node);
    open.push(node);
  });
  return roots;
}

/** Of siblings that touch at a boundary the later one wins, so a cursor on a section's first line belongs to that section. */
export function findDeepestContaining<T extends { children: readonly T[] }>(nodes: readonly T[], contains: (node: T) => boolean): T | undefined {
  const holder = [...nodes].reverse().find(contains);
  return holder && (findDeepestContaining(holder.children, contains) ?? holder);
}
