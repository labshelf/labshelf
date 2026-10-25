// Builds the text of one or many papers as cite keys, BibTeX or a formatted reference, the same for every app.
import { createBibtexEntry } from "../import/bibtex/index.js";
import { formatCitations } from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import type { CitationFormat } from "./store/index.js";

export type CopyFormat = "key" | CitationFormat;

/** @returns one paper's text in a citation style */
export function formatCitation(p: PaperRecord, format: CitationFormat): string {
  return format === "bibtex" ? createBibtexEntry(p, { includeFile: false }) : formatCitations(p)[format];
}

/** @returns the papers' texts in list order: keys comma-joined for a citation command, BibTeX entries blank-line separated */
export function joinCitations(papers: PaperRecord[], format: CopyFormat): string {
  if (format === "key") return papers.map((p) => p.citeKey).join(",");
  return papers.map((p) => formatCitation(p, format)).join(format === "bibtex" ? "\n\n" : "\n");
}
