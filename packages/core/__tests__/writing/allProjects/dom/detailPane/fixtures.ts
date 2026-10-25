// Shares one project row and detail across the All projects detail pane tests.
import type { ProjectDetail, ProjectRow } from "../../../../../src/writing/allProjects/index";

export const NOW = new Date(2026, 9, 17, 12, 0).getTime();
const HOUR = 3_600_000;

export const row: ProjectRow = {
  id: "/lib/projects/attn", title: "Attention <is> all", format: "latex", main: "main.tex", place: "projects",
  modified: NOW - 2 * HOUR, target: { venue: "ICLR 2027", deadline: "2026-11-27" }, folder: "Thesis",
};

export const detail: ProjectDetail = {
  id: row.id, location: "/lib/projects/attn", engine: "xelatex", pages: 8,
  limits: { countUpTo: "references", pages: { counted: 8, limit: 9 }, words: { counted: 5120 } },
  build: { state: "warnings", at: NOW - HOUR, warnings: 2, errors: 0, first: { message: "Overfull hbox", file: "main.tex", line: 12 } },
  log: "main.log",
  bibliography: { file: "refs.bib", entries: 12, generated: true, written: NOW - 2 * HOUR },
  citations: [
    { key: "vaswani2017", source: "library", paperId: "p1", title: "Attention is all you need", authors: "Vaswani et al.", year: "2017" },
    { key: "knuth84", source: "bib", title: "Literate programming", year: "1984" },
    { key: "missing99", source: "none" },
  ],
  versions: [{ name: "v2-submitted", created: new Date(NOW - 3 * 24 * HOUR).toISOString() }],
  sources: ["main.tex", "sections/intro.tex"],
};
