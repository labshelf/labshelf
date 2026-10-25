/** Places a project source line under its checklist section, and indexes the sections that cite each key. */
import { citationSites, sourceHeadings } from "../citations/index.js";
import type { SourceHeading } from "../citations/index.js";
import type { ProjectFormat } from "../project/index.js";

export interface ChecklistSource {
  /** Project-root-relative posix path. */
  path: string;
  format: ProjectFormat;
  text: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  file: string;
  /** Zero-based line of the heading; undefined for a file's own node. */
  line?: number;
}

export type SectionPlacer = (file: string, line: number) => ChecklistSection;

const fileNode = (file: string): ChecklistSection => ({ id: file, title: file, file });

/** Items of the main file go under the nearest heading at or above them; items of an included file go under that file (D14). */
export function sectionPlacer(sources: readonly ChecklistSource[], mainPath: string): SectionPlacer {
  const main = sources.find((source) => source.path === mainPath);
  const headings: SourceHeading[] = main ? sourceHeadings(main.format, main.text) : [];
  return (file, line) => {
    if (file !== mainPath) { return fileNode(file); }
    // INVARIANT: headings are in text order, so the last one at or above the line is the nearest.
    const heading = headings.filter((candidate) => candidate.line <= line).at(-1);
    return heading ? { id: `${file}:${heading.line}`, title: heading.title, file, line: heading.line } : fileNode(file);
  };
}

/** For each cited key, the distinct sections citing it, in source order. */
export function citeSections(sources: readonly ChecklistSource[], mainPath: string): Map<string, ChecklistSection[]> {
  const place = sectionPlacer(sources, mainPath);
  const index = new Map<string, ChecklistSection[]>();
  for (const source of sources) {
    for (const site of citationSites(source.format, source.text)) {
      const section = place(source.path, site.line);
      const sections = index.get(site.key) ?? [];
      if (!sections.some((known) => known.id === section.id)) { sections.push(section); }
      index.set(site.key, sections);
    }
  }
  return index;
}
