/** Formats the citation text, the page argument and the quotation a highlight contributes to it. */

import type { ProjectFormat } from "../project/index.js";

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
