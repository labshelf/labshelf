// Wraps or unwraps selected source text in bold or italic markup for LaTeX and Typst.

type WritingLanguage = "latex" | "typst";

export type WrapKind = "bold" | "italic";

export interface WrapResult {
  text: string;
  /** Offset in `text` where the cursor goes; set only when the selection was empty. */
  cursor?: number;
}

const MARKERS: Record<WritingLanguage, Record<WrapKind, readonly [string, string]>> = {
  latex: { bold: ["\\textbf{", "}"], italic: ["\\emph{", "}"] },
  typst: { bold: ["*", "*"], italic: ["_", "_"] },
};

/** True when `inner` cannot close or reopen the span that surrounds it, so the outer markers belong together. */
function isSingleSpan(language: WritingLanguage, inner: string, open: string): boolean {
  if (language === "typst") { return !inner.includes(open); }
  let depth = 0;
  for (const char of inner) {
    depth += char === "{" ? 1 : char === "}" ? -1 : 0;
    if (depth < 0) { return false; }
  }
  return depth === 0;
}

export function deriveSelectionWrap(language: WritingLanguage, style: WrapKind, selected: string): WrapResult {
  const [open, close] = MARKERS[language][style];
  if (selected === "") { return { text: open + close, cursor: open.length }; }
  const wrapped = selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close);
  const inner = wrapped ? selected.slice(open.length, selected.length - close.length) : "";
  if (wrapped && isSingleSpan(language, inner, open)) { return { text: inner }; }
  return { text: open + selected + close };
}
