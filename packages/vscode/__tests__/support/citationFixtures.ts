// Builds the papers and the citation workspace the citation provider tests share.
import type { PaperRecord } from "@labshelf/core";
import type { CitationWorkspace } from "../../src/writing/citations/index.js";
import { fakeLogger, fakeProjects, readyEntry } from "./writingFixtures";

export function paper(over: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "p1", title: "Attention Is All You Need", path: "p1", citeKey: "vaswani2017", status: "unread", ...over };
}

export const PAPERS: PaperRecord[] = [
  paper({ authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, summary: "The Transformer, a model based on attention." }),
  paper({ id: "p2", title: "Deep Residual Learning", citeKey: "he2016", authors: ["Kaiming He"], year: 2016 }),
];

export function citationWorkspace(
  format: "latex" | "typst" = "latex", papers: PaperRecord[] = PAPERS,
): CitationWorkspace & { logger: ReturnType<typeof fakeLogger> } {
  const logger = fakeLogger();
  const entry = readyEntry("/code/repo", {
    main: format === "latex" ? "main.tex" : "main.typ", settings: { id: "repo", format },
  });
  return { projects: fakeProjects([entry]), session: () => ({ listPapers: async () => papers, logger }), logger };
}
