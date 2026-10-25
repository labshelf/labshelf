/**
 * Formats a quoted passage together with a citation of the paper it came from, in the style chosen by `labshelf.reader.citationStyle`.
 */
import { formatInTextCitation } from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import type { CitationStyle } from "./protocol/index.js";

export type CitablePaper = Pick<PaperRecord, "citeKey" | "title" | "authors" | "year">;

/**
 * Text-layer selections carry hard line breaks and hyphenation from the PDF layout; a quote should read as running prose.
 * @returns the quote with hyphenation joined and whitespace collapsed.
 */
export function normalizeQuote(text: string): string {
  return text
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds the clipboard text for "copy with citation".
 * @returns the quote plus its citation in the requested style.
 */
export function formatQuoteWithCitation(
  text: string,
  paper: CitablePaper,
  pageNumber: number,
  style: CitationStyle,
): string {
  const quote = normalizeQuote(text);
  switch (style) {
    case "pandoc":
      return `> ${quote}\n\n[@${paper.citeKey}, p. ${pageNumber}]`;
    case "latex":
      return `\`\`${quote}'' \\cite[p.~${pageNumber}]{${paper.citeKey}}`;
    case "author-year":
      return `"${quote}" (${formatInTextCitation(paper)}, p. ${pageNumber})`;
    case "citekey":
      return `${quote} @${paper.citeKey}`;
  }
}
