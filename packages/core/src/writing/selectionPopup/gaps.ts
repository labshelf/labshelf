// Where the source editor's insert strip ('——— + ———' on hover) goes: between the blocks of a LaTeX or Typst file, not between every line of a paragraph.
import type { TypingLanguage } from "../typing/helpers.js";

/** A gap after the 1-based `line`; `blank` when the line after it is blank, where the strip sits, else it straddles the edge below the line. */
export interface InsertGap { line: number; blank: boolean }

const LATEX_STRUCTURE = /^\s*\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\b/;
const LATEX_END = /^\s*\\end\s*\{/;
const TYPST_HEADING = /^\s*=+\s/;

/** The body lines of a LaTeX file, 0-based [start, end): those between \begin{document} and \end{document}, or every line without them. */
function bodyRange(language: TypingLanguage, lines: readonly string[]): { start: number; end: number; begin?: number } {
  if (language !== "latex") return { start: 0, end: lines.length };
  const begin = lines.findIndex((line) => /^\s*\\begin\s*\{document\}/.test(line));
  if (begin < 0) return { start: 0, end: lines.length };
  const close = lines.findIndex((line, index) => index > begin && /^\s*\\end\s*\{document\}/.test(line));
  return { start: begin + 1, end: close < 0 ? lines.length : close, begin };
}

/**
 * The gaps of `text`, in order: after a block of text followed by a blank line, after a LaTeX \end{…} line, a sectioning command or a Typst heading,
 * after \begin{document} and after the last line of the body. A LaTeX preamble has none.
 */
export function deriveInsertGaps(language: TypingLanguage, text: string): InsertGap[] {
  const lines = text.split("\n");
  const { start, end, begin } = bodyRange(language, lines);
  const isBlank = (index: number): boolean => index < lines.length && lines[index]!.trim() === "";
  const gaps: InsertGap[] = [];
  if (begin !== undefined) gaps.push({ line: begin + 1, blank: isBlank(begin + 1) });
  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    if (line.trim() === "") continue;
    const next = index + 1;
    const structural = language === "latex" ? LATEX_END.test(line) || LATEX_STRUCTURE.test(line) : TYPST_HEADING.test(line);
    if (isBlank(next) || structural || next >= end) gaps.push({ line: index + 1, blank: isBlank(next) });
  }
  return gaps;
}
