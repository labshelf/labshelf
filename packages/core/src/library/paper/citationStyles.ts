/**
 * Formats a paper as a ready-to-paste reference in APA 7, MLA 9 and Chicago author-date, and as an in-text marker,
 * from whatever bibliographic fields the record has. Missing fields are left out rather than guessed.
 */
import type { PaperRecord } from "../../model/index.js";
import { formatAuthors, splitName, type PersonName } from "./authors.js";
import { paperLink } from "./paperUrl.js";

export type CitedPaper = Pick<PaperRecord, "title" | "authors" | "year" | "journal" | "publisher" | "volume" | "issue" | "pages" | "doi" | "url">;

export interface CitationSet {
  apa: string;
  mla: string;
  chicago: string;
  /** Short in-text form, e.g. "Vaswani et al., 2017". */
  inText: string;
}

/** @returns "Family, year", "A & B, year" or "A et al., year"; the title stands in for no authors and "n.d." for no year. */
export function inTextCitation(paper: Pick<PaperRecord, "title" | "authors" | "year">): string {
  return `${formatAuthors(paper.authors) || paper.title}, ${paper.year ?? "n.d."}`;
}

/** @returns every reference style for one paper */
export function formatCitations(paper: CitedPaper): CitationSet {
  return { apa: apa(paper), mla: mla(paper), chicago: chicago(paper), inText: inTextCitation(paper) };
}

function initials(given: string): string {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part.split("-").map((piece) => piece.charAt(0).toUpperCase() + ".").join("-"))
    .join(" ");
}

function names(paper: CitedPaper): PersonName[] {
  return (paper.authors ?? []).filter((a) => a.trim()).map(splitName);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

const dashes = (pages: string): string => pages.replace(/-+/g, "–");

function apaAuthors(list: PersonName[]): string {
  const formatted = list.map((n) => (n.given ? `${n.family}, ${initials(n.given)}` : n.family));
  // Up to 20 authors with "&" before the last; beyond that, the first 19, an ellipsis and the last.
  if (formatted.length > 20) { return `${formatted.slice(0, 19).join(", ")}, … ${formatted[formatted.length - 1]}`; }
  if (formatted.length > 1) { return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`; }
  return formatted.join("");
}

function apa(paper: CitedPaper): string {
  const authors = apaAuthors(names(paper));
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push(`(${paper.year ?? "n.d."}).`, sentence(paper.title));
  const venue = paper.journal ?? paper.publisher;
  if (venue) {
    let source = venue;
    if (paper.volume) { source += `, ${paper.volume}${paper.issue ? `(${paper.issue})` : ""}`; }
    if (paper.pages) { source += `, ${dashes(paper.pages)}`; }
    parts.push(`${source}.`);
  }
  const link = paperLink(paper);
  if (link) { parts.push(link); }
  return parts.join(" ");
}

function mlaAuthors(list: PersonName[]): string {
  const [first, second] = list;
  if (!first) { return ""; }
  if (list.length === 1) { return first.given ? `${first.family}, ${first.given}` : first.family; }
  if (list.length === 2) { return `${first.family}, ${first.given}, and ${[second!.given, second!.family].filter(Boolean).join(" ")}`; }
  return `${first.family}, ${first.given}, et al`;
}

function mla(paper: CitedPaper): string {
  const authors = mlaAuthors(names(paper));
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push(`“${sentence(paper.title)}”`);
  const container: string[] = [];
  const venue = paper.journal ?? paper.publisher;
  if (venue) { container.push(venue); }
  if (paper.volume) { container.push(`vol. ${paper.volume}`); }
  if (paper.issue) { container.push(`no. ${paper.issue}`); }
  if (paper.year) { container.push(String(paper.year)); }
  if (paper.pages) { container.push(`pp. ${dashes(paper.pages)}`); }
  if (container.length) { parts.push(`${container.join(", ")}.`); }
  if (paper.doi) { parts.push(sentence(`https://doi.org/${paper.doi}`)); }
  return parts.join(" ");
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) { return items.join(""); }
  if (items.length === 2) { return `${items[0]} and ${items[1]}`; }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function chicago(paper: CitedPaper): string {
  const formatted = names(paper).map((n, i) => (!n.given ? n.family : i === 0 ? `${n.family}, ${n.given}` : `${n.given} ${n.family}`));
  // Chicago 17 author-date lists up to ten authors; with more, the first seven and "et al."
  const authors = formatted.length > 10 ? `${formatted.slice(0, 7).join(", ")}, et al` : joinWithAnd(formatted);
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push(sentence(String(paper.year ?? "n.d.")), `“${sentence(paper.title)}”`);
  const venue = paper.journal ?? paper.publisher;
  if (venue) {
    let source = venue;
    if (paper.volume) { source += ` ${paper.volume}${paper.issue ? ` (${paper.issue})` : ""}`; }
    if (paper.pages) { source += `: ${dashes(paper.pages)}`; }
    parts.push(`${source}.`);
  }
  const link = paperLink(paper);
  if (link) { parts.push(sentence(link)); }
  return parts.join(" ");
}
