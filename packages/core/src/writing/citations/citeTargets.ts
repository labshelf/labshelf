/** What a citation of one paper can point at (the whole paper, a page, a highlight with or without its quotation, a note) and how the citation at the cursor is rewritten to point there. */

import type { Annotation } from "../../model/index.js";
import type { CitationCardNote } from "../../reader/index.js";
import type { ItemFile, ItemSegment } from "../../qmd/item/itemFile.js";
import type { ProjectFormat } from "../project/index.js";
import { derivePageSupplement, deriveQuotationBefore } from "./citeKeys.js";
import { listQuotableHighlights } from "./quotes.js";

// --- Targets ---

export type CiteTarget =
  | { kind: "paper" }
  /** A page the user types; the completion inserts the page slot. */
  | { kind: "page" }
  | { kind: "highlight"; page: number; text: string; quote: boolean }
  /** A note of the paper; `page` comes from its anchor and is absent for a note anchored nowhere. */
  | { kind: "note"; text: string; page?: number; withText: boolean };

/** The first non-empty line of a note body, as the lists show it. */
function noteText(item: ItemSegment): string {
  return item.body.split(/\r\n|\n|\r/).map((line) => line.trim()).find((line) => line !== "") ?? "";
}

/** The page a note's anchor names: a point or box on a page, or the page of the highlight it hangs on. */
export function deriveNotePage(item: Pick<ItemSegment, "anchor">, annotations: readonly Annotation[]): number | undefined {
  const { anchor } = item;
  if (anchor.kind === "point" || anchor.kind === "box") { return anchor.page; }
  if (anchor.kind === "highlight") { return annotations.find((annotation) => annotation.id === anchor.annotationId)?.pageNumber; }
  return undefined;
}

/**
 * Every target of one paper, in the order a list shows them: the whole paper, a page, then highlights and notes by page
 * (notes without a page last). Each highlight comes twice (page only, page plus quotation) and each note twice (citation
 * only, citation after the note's text).
 */
export function listCiteTargets(annotations: readonly Annotation[], notes: ItemFile | undefined): CiteTarget[] {
  const highlights: CiteTarget[] = listQuotableHighlights(annotations)
    .sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt))
    .flatMap((highlight) => [false, true].map((quote) => ({ kind: "highlight" as const, page: highlight.pageNumber, text: highlight.content.trim(), quote })));
  const items = (notes?.segments ?? []).filter((segment): segment is ItemSegment => segment.kind === "item");
  const noted: CiteTarget[] = items
    .map((item) => ({ text: noteText(item), page: deriveNotePage(item, annotations) }))
    .filter((note) => note.text !== "")
    .sort((a, b) => (a.page ?? Infinity) - (b.page ?? Infinity))
    .flatMap((note) => [false, true].map((withText) => ({ kind: "note" as const, text: note.text, ...(note.page === undefined ? {} : { page: note.page }), withText })));
  const byPage = [...highlights, ...noted].sort((a, b) => targetPage(a) - targetPage(b));
  return [{ kind: "paper" }, { kind: "page" }, ...byPage];
}

/** At most `limit` notes with text: those on `citedPage` first, then by page (notes without a page last), then in file order. */
export function listCardNotes(notes: ItemFile | undefined, annotations: readonly Annotation[], limit: number, citedPage?: number): CitationCardNote[] {
  const items = (notes?.segments ?? []).filter((segment): segment is ItemSegment => segment.kind === "item");
  const onCitedPage = (note: CitationCardNote): number => (note.page !== undefined && note.page === citedPage ? 0 : 1);
  return items
    .map((item): CitationCardNote => {
      const page = deriveNotePage(item, annotations);
      return { text: noteText(item), ...(page === undefined ? {} : { page }) };
    })
    .filter((note) => note.text !== "")
    .map((note, index) => ({ note, index }))
    .sort((a, b) => onCitedPage(a.note) - onCitedPage(b.note) || (a.note.page ?? Infinity) - (b.note.page ?? Infinity) || a.index - b.index)
    .slice(0, limit)
    .map(({ note }) => note);
}

const targetPage = (target: CiteTarget): number => ("page" in target && target.page !== undefined ? target.page : Infinity);

// Short enough that the variant tag at the label's start and the detail both stay visible in a completion list.
const LABEL_LENGTH = 56;

function cut(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LENGTH ? `${flat.slice(0, LABEL_LENGTH).trimEnd()}…` : flat;
}

/** The words a completion list shows for a target. */
export function formatCiteTarget(target: CiteTarget): { label: string; detail: string } {
  switch (target.kind) {
    case "paper": return { label: "Whole paper", detail: "Cite without a page" };
    case "page": return { label: "Page…", detail: "Cite a page you type" };
    // The two variants of one highlight or note share their text, so the label starts with what tells them apart.
    case "highlight": return {
      label: `${target.quote ? "Quote" : "Page"} p. ${target.page} — ${cut(target.text)}`,
      detail: target.quote ? "Highlight + quotation" : "Highlight",
    };
    case "note": return {
      label: `${target.withText ? "Note text" : "Note"}${target.page === undefined ? "" : ` p. ${target.page}`} — ${cut(target.text)}`,
      detail: target.withText ? "Note text + citation" : target.page === undefined ? "Note, no page" : "Note",
    };
  }
}

// --- The citation at the cursor ---

/** A citation of exactly one key with the cursor at the end of the key; the columns are those of its line. */
export interface CitedKeyContext {
  key: string;
  /** Column of the `\` or the `@`/`#`. */
  commandStart: number;
  /** Column after the whole citation, its closing `}` or `)` or the key of `@key`. */
  commandEnd: number;
  /** LaTeX: the command name, e.g. `\citep`; Typst: `@` or `#cite`. */
  command: string;
}

// The cite command with an empty optional-argument list, its one key and the cursor at the key's end.
const LATEX_BEFORE = /\\([A-Za-z]*[Cc]ite[A-Za-z]*\*?)\s*\{\s*([^\s,{}[\]]+)$/;
const TYPST_REFERENCE_BEFORE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)$/u;
const TYPST_CITE_BEFORE = /#cite\(\s*<([^>\s]+)$/;

/**
 * The single-key citation whose key ends at the cursor, e.g. `\citep{key|}` or `@key|`, or undefined. A citation that
 * already has a page or several keys is not one: its page argument is completed where it is typed.
 */
export function deriveCitedKeyContext(format: ProjectFormat, before: string, after: string): CitedKeyContext | undefined {
  if (format === "latex") {
    const open = LATEX_BEFORE.exec(before);
    const close = /^\s*\}/.exec(after);
    if (!open || !close) { return undefined; }
    return { key: open[2]!, commandStart: open.index, commandEnd: before.length + close[0].length, command: `\\${open[1]!}` };
  }
  const cite = TYPST_CITE_BEFORE.exec(before);
  if (cite) {
    const close = /^>\s*\)/.exec(after);
    if (!close) { return undefined; }
    return { key: cite[1]!, commandStart: cite.index, commandEnd: before.length + close[0].length, command: "#cite" };
  }
  const reference = TYPST_REFERENCE_BEFORE.exec(before);
  // A reference that already has a supplement, `@key[`, is completed as a page argument.
  if (!reference || /^[\p{L}\p{N}_:.-]/u.test(after) || after.startsWith("[")) { return undefined; }
  return { key: reference[1]!, commandStart: reference.index, commandEnd: before.length, command: "@" };
}

/** Where the page goes in the text a `page` target writes; the editors turn it into a snippet slot. */
export const PAGE_SLOT = "\u0000";

const LATEX_TEXT_SPECIAL = /[\\&%$#_{}~^]/g;
const LATEX_TEXT_ESCAPE: Record<string, string> = {
  "\\": String.raw`\textbackslash{}`, "~": String.raw`\textasciitilde{}`, "^": String.raw`\textasciicircum{}`,
};
const TYPST_TEXT_SPECIAL = /[\\#$@*_<`[\]]/g;

/** A note is the user's own words, so its text goes before the citation as plain prose, not as a quotation. */
function proseBefore(format: ProjectFormat, text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return format === "latex"
    ? `${flat.replace(LATEX_TEXT_SPECIAL, (char) => LATEX_TEXT_ESCAPE[char] ?? `\\${char}`)}~`
    : `${flat.replace(TYPST_TEXT_SPECIAL, (char) => `\\${char}`)} `;
}

function withPage(format: ProjectFormat, context: CitedKeyContext, supplement: string): string {
  if (format === "latex") { return `${context.command}[${supplement}]{${context.key}}`; }
  if (context.command === "#cite") { return `#cite(<${context.key}>, supplement: [${supplement}])`; }
  return `@${context.key}[${supplement}]`;
}

/**
 * The text that replaces the citation (columns `commandStart` to `commandEnd`) to cite the target; undefined for the whole
 * paper, which leaves the citation as it is. A `page` target's text holds `PAGE_SLOT` where the page is typed.
 */
export function rewriteCitation(format: ProjectFormat, context: CitedKeyContext, target: CiteTarget): string | undefined {
  switch (target.kind) {
    case "paper": return undefined;
    case "page": {
      const supplement = derivePageSupplement(format, 0).replace(/0$/, PAGE_SLOT);
      return withPage(format, context, supplement);
    }
    case "highlight": {
      const citation = withPage(format, context, derivePageSupplement(format, target.page));
      return target.quote ? `${deriveQuotationBefore(format, target.text)}${citation}` : citation;
    }
    case "note": {
      const citation = target.page === undefined
        ? (format === "latex" ? `${context.command}{${context.key}}` : context.command === "#cite" ? `#cite(<${context.key}>)` : `@${context.key}`)
        : withPage(format, context, derivePageSupplement(format, target.page));
      return target.withText ? `${proseBefore(format, target.text)}${citation}` : citation;
    }
  }
}

/** The text a page-argument completion writes for a note: its page, or undefined for a note without one. */
export function deriveNotePageSupplement(format: ProjectFormat, target: Extract<CiteTarget, { kind: "note" }>): string | undefined {
  return target.page === undefined ? undefined : derivePageSupplement(format, target.page);
}

/** The note's text as prose before a citation, for a page-argument completion that writes it ahead of the command. */
export function deriveNoteProseBefore(format: ProjectFormat, text: string): string {
  return proseBefore(format, text);
}
