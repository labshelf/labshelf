// Builds the papers and the citation workspace the citation provider tests share.
import type { Annotation, ChecklistSection, PaperRecord } from "@labshelf/core";
import type { CitationWorkspace } from "../../src/writing/citations/index.js";
import { fakeLogger, fakeProjects, readyEntry } from "./writingFixtures";

export function paper(over: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "p1", title: "Attention Is All You Need", path: "p1", citeKey: "vaswani2017", status: "unread", ...over };
}

export const PAPERS: PaperRecord[] = [
  paper({ authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, summary: "The Transformer, a model based on attention." }),
  paper({ id: "p2", title: "Deep Residual Learning", citeKey: "he2016", authors: ["Kaiming He"], year: 2016 }),
];

export function highlight(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "h1", paperId: "p1", type: "highlight", pageNumber: 4, content: "Attention is all you need",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  };
}

/** Sections that cite each key, and the section the cursor is in (what `sectionAt` answers). */
export interface FakeSections { byKey: Record<string, ChecklistSection[]>; current?: ChecklistSection }

export function citationWorkspace(
  format: "latex" | "typst" = "latex", papers: PaperRecord[] = PAPERS,
  annotations: Record<string, Annotation[]> = {}, sections: FakeSections = { byKey: {} },
): CitationWorkspace & { logger: ReturnType<typeof fakeLogger> } {
  const logger = fakeLogger();
  const entry = readyEntry("/code/repo", {
    main: format === "latex" ? "main.tex" : "main.typ", settings: { id: "repo", format },
  });
  return { projects: fakeProjects([entry]), session: () => ({ listPapers: async () => papers, highlightsOf: async (id) => annotations[id] ?? [],
    citeSections: async () => ({ byKey: new Map(Object.entries(sections.byKey)), sectionAt: () => sections.current }), logger }), logger };
}
