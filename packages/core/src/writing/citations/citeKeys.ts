/** Finds and writes the cite keys of a project's sources: scanning a LaTeX or Typst source for citations and headings, where a key is being typed, the citation text and page argument, the words of the Cite from Library pickers, the suggestion for an undefined key, and papers by cite key. */

import type { Annotation, PaperRecord } from "../../model/index.js";
import { deriveCiteKeySlug, STATUS_LABEL } from "../../library/index.js";
import { scanLatexSource } from "../../latex/index.js";
import { scanTypstHeadings } from "../../typst/language/index.js";
import { findLineOfOffset, deriveLineOffsets } from "../../text/index.js";
import type { ProjectFormat } from "../project/index.js";

// --- Citation scanning ---

// \cite, \citep, \citet*, \autocite, \parencite, \textcite, \footcite, \nocite, \Citeauthor, ... with up to two
// optional arguments before the key list.
const LATEX_CITE_COMMAND = String.raw`\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?\s*(?:\[[^\]]*\]\s*){0,2}\{`;
const LATEX_CITE = new RegExp(`${LATEX_CITE_COMMAND}([^}]*)\\}`, "g");
// TRAP: a `%` escaped as `\%` is text, not a comment.
const LATEX_COMMENT = /(?<!\\)%.*$/gm;

// Typst label characters; a reference preceded by a word character is an e-mail address, not a citation.
const TYPST_REFERENCE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)/gu;
const TYPST_CITE_LABEL = /#cite\(\s*(?:<([^>\s]+)>|label\(\s*"([^"]+)"\s*\))/g;
const TYPST_COMMENT = /\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm;
// A URL in markup is a link, and an `@` in its path is not a reference.
const TYPST_URL = /https?:\/\/\S+/g;

export interface CiteKeyOccurrence {
  key: string;
  /** Character offsets of the key in the text. */
  start: number;
  end: number;
  /** The whole citing command, e.g. `\cite[p.~4]{a, b}` or `@a`. */
  command: string;
  /** The page a LaTeX `[p.~N]` argument names. */
  page?: number;
}

const PAGE_ARGUMENT = /^\s*p\.~?\s*(\d+)\s*$/;

// Blanks out what is not source while keeping every offset, so matches still point into the real text.
const blank = (text: string, pattern: RegExp): string => text.replace(pattern, (match) => match.replace(/[^\n]/g, " "));

function pageOf(command: string): number | undefined {
  for (const argument of command.slice(0, command.lastIndexOf("{")).matchAll(/\[([^\]]*)\]/g)) {
    const page = PAGE_ARGUMENT.exec(argument[1]!)?.[1];
    if (page) { return Number(page); }
  }
  return undefined;
}

function latexKeys(text: string): CiteKeyOccurrence[] {
  return [...blank(text, LATEX_COMMENT).matchAll(LATEX_CITE)].flatMap((match) => {
    const listStart = match.index + match[0].length - 1 - match[1]!.length;
    const page = pageOf(match[0]);
    return [...match[1]!.matchAll(/[^,\s][^,]*/g)].map((part) => {
      const key = part[0].trimEnd();
      return { key, start: listStart + part.index, end: listStart + part.index + key.length, command: match[0], ...(page !== undefined ? { page } : {}) };
    });
  });
}

// The `#cite(...)` call up to its closing parenthesis; an unclosed call runs to the end of the line.
function typstCall(source: string, from: number): string {
  const lineEnd = source.indexOf("\n", from) < 0 ? source.length : source.indexOf("\n", from);
  let depth = 0;
  for (let i = from; i < lineEnd; i++) {
    if (source[i] === "(") { depth++; }
    else if (source[i] === ")" && --depth === 0) { return source.slice(from, i + 1); }
  }
  return source.slice(from, lineEnd);
}

function typstKeys(text: string): CiteKeyOccurrence[] {
  const source = blank(blank(text, TYPST_COMMENT), TYPST_URL);
  const references = [...source.matchAll(TYPST_REFERENCE)].map((match) => {
    // PLATFORM: Typst drops a trailing `.` or `:` from `@key.` so that a reference can end a sentence.
    const key = match[1]!.replace(/[.:]+$/, "");
    return { key, start: match.index + 1, end: match.index + 1 + key.length, command: `@${key}` };
  });
  const labels = [...source.matchAll(TYPST_CITE_LABEL)].map((match) => {
    const key = (match[1] ?? match[2])!;
    const start = match.index + match[0].lastIndexOf(key);
    return { key, start, end: start + key.length, command: typstCall(source, match.index) };
  });
  return [...references, ...labels].sort((a, b) => a.start - b.start);
}

/** Every citation in the text with its position, in text order; `*` (cite everything) is not a key. */
export function findCiteKeyOccurrences(format: ProjectFormat, text: string): CiteKeyOccurrence[] {
  return (format === "latex" ? latexKeys(text) : typstKeys(text)).filter((cited) => cited.key !== "*");
}

/** Every key cited in the text, without duplicates. */
export function scanCiteKeys(format: ProjectFormat, text: string): string[] {
  return [...new Set(findCiteKeyOccurrences(format, text).map((cited) => cited.key))];
}

export interface SourceHeading {
  /** Zero-based line of the heading. */
  line: number;
  title: string;
}

/** Headings of a LaTeX or Typst source in text order, each with the line it starts on. */
export function findSourceHeadings(format: ProjectFormat, text: string): SourceHeading[] {
  if (format === "typst") { return scanTypstHeadings(text).map(({ line, title }) => ({ line, title })); }
  return scanLatexSource(text).sections.map((section) => ({ line: section.range.start.line, title: section.title }));
}

// --- Headings and citation sites ---

export interface CitationSite {
  key: string;
  /** Zero-based line of the key. */
  line: number;
  /** Title of the nearest heading above; undefined before the first heading. */
  section: string | undefined;
}

/** Every citation in the text, in text order, placed by line and by the heading it falls under. */
export function findCitationSites(format: ProjectFormat, text: string): CitationSite[] {
  const starts = deriveLineOffsets(text);
  const headings = findSourceHeadings(format, text);
  let next = 0;
  let section: string | undefined;
  return findCiteKeyOccurrences(format, text).map((cited) => {
    const line = findLineOfOffset(starts, cited.start);
    // A heading's own line counts as under it, so `\section{X \cite{k}}` is in X.
    while (next < headings.length && headings[next]!.line <= line) { section = headings[next++]!.title; }
    return { key: cited.key, line, section };
  });
}

// --- Key being typed ---

const LATEX_OPEN_CITE = new RegExp(`${LATEX_CITE_COMMAND}[^}]*$`);
const TYPST_OPEN_REFERENCE = /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_:.-]*$/u;
const TYPST_OPEN_CITE = /#cite\(\s*<[^>\s]*$/;

/** Where a key is being typed, so an editor can offer library papers there: column where the partial key before the cursor starts, or undefined when the cursor is not in a citation. */
export function findPartialCiteKeyStart(format: ProjectFormat, linePrefix: string): number | undefined {
  if (format === "latex") {
    if (!LATEX_OPEN_CITE.test(linePrefix)) { return undefined; }
    let start = Math.max(linePrefix.lastIndexOf("{"), linePrefix.lastIndexOf(",")) + 1;
    while (linePrefix[start] === " ") { start += 1; }
    return start;
  }
  const open = TYPST_OPEN_REFERENCE.exec(linePrefix) ?? TYPST_OPEN_CITE.exec(linePrefix);
  if (!open) { return undefined; }
  return open.index + open[0].search(/[@<]/) + 1;
}

// --- Page argument ---

// The first optional argument of a cite command, still open at the cursor.
const LATEX_OPEN_PAGE = /\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?\s*\[([^\]]*)$/;
// The rest of the argument, its closing bracket and the key list that follows, if any.
const LATEX_TAIL = /^[^\]]*\](\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\})?/;
const TYPST_OPEN_SUPPLEMENT = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)\[([^\]]*)$/u;

export interface PageArgumentContext {
  /** The cited key when the context names exactly one. */
  key?: string;
  /** Column where the typed page text begins. */
  start: number;
  /** Column of the `]` that closes the argument, when it is on the line. */
  close?: number;
  /** Whether a non-empty key list follows the argument (Typst always has its key before it). */
  hasKeys: boolean;
  /** Without keys: the column after the `]`, or after an empty `{}` that follows it. */
  end?: number;
  /** Column where the citation starts: the `\` of the command or the `@`. */
  commandStart: number;
}

function latexContext(before: string, after: string): PageArgumentContext | undefined {
  const open = LATEX_OPEN_PAGE.exec(before);
  if (!open) { return undefined; }
  const tail = LATEX_TAIL.exec(after);
  const list = tail?.[2];
  const hasKeys = list !== undefined && list.trim() !== "";
  return {
    ...(list !== undefined && !list.includes(",") && list.trim() !== "" ? { key: list.trim() } : {}),
    start: open.index + open[0].length - open[1]!.length,
    ...(tail ? { close: before.length + tail[0].indexOf("]") } : {}),
    hasKeys,
    ...(tail && !hasKeys ? { end: before.length + tail[0].length } : {}),
    commandStart: open.index,
  };
}

function typstContext(before: string, after: string): PageArgumentContext | undefined {
  const open = TYPST_OPEN_SUPPLEMENT.exec(before);
  if (!open) { return undefined; }
  const close = after.indexOf("]");
  return {
    key: open[1]!,
    start: open.index + open[0].length - open[2]!.length,
    ...(close === -1 ? {} : { close: before.length + close }),
    hasKeys: true,
    commandStart: open.index,
  };
}

/** The page argument of a citation being typed (`\cite[` or `@key[`), so an editor can offer highlights there: its context at the cursor, given the line text before and after it, or undefined outside one. */
export function derivePageArgument(format: ProjectFormat, before: string, after: string): PageArgumentContext | undefined {
  return format === "latex" ? latexContext(before, after) : typstContext(before, after);
}

// --- Citation text ---

const LATEX_SPECIAL = /[\\&%$#_{}~^]/g;
const LATEX_ESCAPE: Record<string, string> = {
  "\\": String.raw`\textbackslash{}`, "~": String.raw`\textasciitilde{}`, "^": String.raw`\textasciicircum{}`,
};
const TYPST_SPECIAL = /[\\#$@*_<`]/g;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The page as the page argument reads: `p.~4` in LaTeX (no line break after `p.`), `p. 4` in Typst. */
export function derivePageSupplement(format: ProjectFormat, page: number): string {
  return format === "latex" ? `p.~${page}` : `p. ${page}`;
}

/** The highlighted text as a quotation placed before the citation, with markup characters escaped. */
export function deriveQuotationBefore(format: ProjectFormat, text: string): string {
  const quote = oneLine(text);
  if (format === "latex") {
    return `\`\`${quote.replace(LATEX_SPECIAL, (char) => LATEX_ESCAPE[char] ?? `\\${char}`)}''~`;
  }
  return `"${quote.replace(TYPST_SPECIAL, (char) => `\\${char}`)}" `;
}

/** The citation of a key as the format writes it, with the page argument and the quotation of a highlight when given. */
export function createCitationSnippet(
  format: ProjectFormat, key: string, options: { page?: number; quotation?: string } = {},
): string {
  const supplement = options.page === undefined ? undefined : derivePageSupplement(format, options.page);
  const citation = format === "latex"
    ? `\\cite${supplement === undefined ? "" : `[${supplement}]`}{${key}}`
    : `@${key}${supplement === undefined ? "" : `[${supplement}]`}`;
  return `${options.quotation === undefined ? "" : deriveQuotationBefore(format, options.quotation)}${citation}`;
}

// --- Picker text ---

const LABEL_LENGTH = 120;

/** `highlight` is undefined for a citation without a page. */
export interface HighlightChoice {
  highlight?: Annotation;
  quote: boolean;
}

export interface PickText {
  label: string;
  description: string;
  detail: string;
}

export const CITE_WITHOUT_PAGE = "Cite without a page";

/** The label, description and detail the Cite from Library picker shows for a paper. */
export function derivePaperPickText(paper: PaperRecord): PickText {
  return {
    label: paper.title,
    description: `@${paper.citeKey}`,
    detail: `${STATUS_LABEL[paper.status]}${paper.year ? ` · ${paper.year}` : ""}`,
  };
}

/** The highlight's text on one line, cut to the width of a list row. */
export function formatHighlightLabel(highlight: Annotation): string {
  const flat = highlight.content.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LENGTH ? `${flat.slice(0, LABEL_LENGTH).trimEnd()}…` : flat;
}

export const formatHighlightPage = (highlight: Annotation): string => `p. ${highlight.pageNumber}`;

/** The page and quotation options of `createCitationSnippet` for a choice. */
export function deriveChoiceCitationSpec({ highlight, quote }: HighlightChoice): { page?: number; quotation?: string } {
  return {
    ...(highlight ? { page: highlight.pageNumber } : {}),
    ...(highlight && quote ? { quotation: highlight.content } : {}),
  };
}

// --- Suggested key ---

export interface SuggestableCiteKey {
  key: string;
  authors: string[];
  year?: string;
}

const SURNAME_BONUS = 0.15;
const YEAR_BONUS = 0.1;
// Below this score a key is unrelated: one edit in a 20-letter key scores 0.95 before any bonus.
const MIN_SCORE = 0.8;

/** The shelf key the undefined `missing` most likely meant, ranked by edit distance and author/year overlap, or undefined when no key is close; ties go to the key that sorts first. */
export function deriveSuggestedCiteKey(missing: string, keys: readonly SuggestableCiteKey[]): string | undefined {
  const wanted = missing.toLowerCase();
  if (wanted === "") { return undefined; }
  const surname = leadingLetters(wanted);
  const year = /(?:19|20)\d\d/.exec(wanted)?.[0];
  let best: { key: string; score: number } | undefined;
  for (const candidate of keys) {
    const score = scoreOf(wanted, surname, year, candidate);
    if (score === undefined || score < MIN_SCORE) { continue; }
    if (!best || score > best.score || (score === best.score && candidate.key < best.key)) { best = { key: candidate.key, score }; }
  }
  return best?.key;
}

/** Undefined when the missing key names another author than both the candidate's key and its first author. */
function scoreOf(wanted: string, surname: string, year: string | undefined, candidate: SuggestableCiteKey): number | undefined {
  const key = candidate.key.toLowerCase();
  const authorSurname = deriveCiteKeySlug(candidate.authors[0]?.trim().split(/\s+/).pop() ?? "");
  const authorMatches = surname !== "" && authorSurname !== "" && closeSurname(surname, authorSurname);
  if (surname !== "" && !authorMatches && !closeSurname(surname, leadingLetters(key))) { return undefined; }
  const similarity = 1 - editDistance(wanted, key) / Math.max(wanted.length, key.length);
  return similarity + (authorMatches ? SURNAME_BONUS : 0) + (year !== undefined && year === candidate.year ? YEAR_BONUS : 0);
}

function leadingLetters(key: string): string {
  return /^[a-z]+/.exec(key)?.[0] ?? "";
}

/** A typo or two, scaled to the surname's length. */
function closeSurname(a: string, b: string): boolean {
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3));
}

/** Levenshtein distance over UTF-16 code units. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(substitution, previous[j]! + 1, current[j - 1]! + 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

// --- Papers by cite key ---

/** Indexes library papers by cite key, the way every writing feature resolves a citation. Keys are case-sensitive, as in BibTeX. */
export function derivePapersByCiteKey(papers: readonly PaperRecord[]): Map<string, PaperRecord> {
  const byKey = new Map<string, PaperRecord>();
  // INVARIANT: on a duplicate cite key the paper with the smallest id wins, so the result does not depend on scan order.
  const ordered = [...papers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const paper of ordered) { if (!byKey.has(paper.citeKey)) { byKey.set(paper.citeKey, paper); } }
  return byKey;
}
