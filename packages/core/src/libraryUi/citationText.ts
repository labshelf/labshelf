// Builds the text of one or many papers as cite keys, BibTeX or a formatted reference, the same for every app.
import { bibtexEntry } from "../import/bibtex/index.js";
import { formatCitations } from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import type { CiteFormat } from "./store/index.js";

export type CopyFormat = "key" | CiteFormat;

/** @returns one paper's text in a citation style */
export function citationText(p: PaperRecord, format: CiteFormat): string {
  return format === "bibtex" ? bibtexEntry(p, { includeFile: false }) : formatCitations(p)[format];
}

/** @returns the papers' texts in list order: keys comma-joined for a citation command, BibTeX entries blank-line separated */
export function joinCitations(papers: PaperRecord[], format: CopyFormat): string {
  if (format === "key") return papers.map((p) => p.citeKey).join(",");
  return papers.map((p) => citationText(p, format)).join(format === "bibtex" ? "\n\n" : "\n");
}
