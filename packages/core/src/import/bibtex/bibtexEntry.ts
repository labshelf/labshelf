/** Formats a paper as one BibTeX @article entry, for bib.bib files and for copying. */
import { joinWith, paperFiles } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";

const posixJoin = joinWith("/");

// Braces would break the entry's own delimiters.
const esc = (value: string): string => value.replace(/[{}]/g, "");

function authorField(authors: string[] | undefined): string {
  const normalized = (authors ?? []).map((a) => a.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.map(esc).join(" and ") : "Unknown";
}

/**
 * `includeFile` (default true) emits the `file = {…/paper.pdf}` line; pass false when the folder holds no paper.pdf
 * or the entry leaves this device, so it never points at a file that is not there.
 * @returns the entry text
 */
export function bibtexEntry(paper: PaperRecord, options: { includeFile?: boolean } = {}): string {
  const lines: string[] = [`@article{${paper.citeKey},`, `  title = {${esc(paper.title)}},`, `  author = {${authorField(paper.authors)}},`];
  if (paper.year) { lines.push(`  year = {${paper.year}},`); }
  const fields: Array<[string, string | undefined]> = [
    ["journal", paper.journal], ["publisher", paper.publisher], ["volume", paper.volume], ["number", paper.issue],
    ["pages", paper.pages], ["doi", paper.doi], ["issn", paper.issn], ["url", paper.url], ["language", paper.language],
    ["note", paper.summary],
  ];
  for (const [name, value] of fields) { if (value) { lines.push(`  ${name} = {${esc(value)}},`); } }
  if (options.includeFile !== false) { lines.push(`  file = {${esc(paperFiles(paper.path, posixJoin).pdf)}},`); }
  lines.push("  keywords = {labshelf, imported}", "}");
  return lines.join("\n");
}
