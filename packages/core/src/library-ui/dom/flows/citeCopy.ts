/**
 * Copies papers as cite keys, BibTeX or a formatted reference. The text is built here from the records, so every host
 * copies the same thing; the host only writes the clipboard.
 */
import { bibtexEntry } from "../../../import/bibtex/index.js";
import { formatCitations } from "../../../library/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { CiteFormat } from "../../state/index.js";
import type { UiContext } from "../uiContext.js";

export type CopyFormat = "key" | CiteFormat;

export const CITE_LABEL: Record<CiteFormat, string> = { bibtex: "BibTeX", apa: "APA", mla: "MLA", chicago: "Chicago", inText: "In-text" };

const COPIED_LABEL: Record<CopyFormat, string> = {
  key: "cite key", bibtex: "BibTeX", apa: "APA reference", mla: "MLA reference", chicago: "Chicago reference", inText: "in-text citation",
};

/** @returns one paper's text in a citation style */
export function citationText(p: PaperRecord, format: CiteFormat): string {
  return format === "bibtex" ? bibtexEntry(p, { includeFile: false }) : formatCitations(p)[format];
}

function joined(papers: PaperRecord[], format: CopyFormat): string {
  if (format === "key") return papers.map((p) => p.citeKey).join(",");
  return papers.map((p) => citationText(p, format)).join(format === "bibtex" ? "\n\n" : "\n");
}

/** Copies the given papers, in list order; keys are comma-joined, ready for a citation command. */
export function copyCitation(ctx: UiContext, ids: readonly string[], format: CopyFormat): void {
  const wanted = new Set(ids);
  const papers = ctx.store.get().papers.filter((p) => wanted.has(p.id));
  if (papers.length === 0) return;
  const label = papers.length === 1 ? COPIED_LABEL[format] : `${papers.length} × ${COPIED_LABEL[format]}`;
  ctx.transport.post({ type: "clipboard.write", text: joined(papers, format), label });
}

/** Copies any text the pane shows, such as a DOI or the abstract. */
export function copyText(ctx: UiContext, text: string, label: string): void {
  if (text) ctx.transport.post({ type: "clipboard.write", text, label });
}
