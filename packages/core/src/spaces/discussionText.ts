// Turns a discussion message into the one-line plain text its previews show: rows, the Space chat card, Continue cards and search hits.
/** What a preview shows in place of inline or display math, whose TeX would read as noise. */
export const MATH_PLACEHOLDER = "[equation]";

// Display math first, so `$$…$$` is never read as two empty inline spans; `\$` is a literal dollar.
const MATH = /\$\$[\s\S]*?(?:\$\$|$)|\\\[[\s\S]*?(?:\\\]|$)|\\\([\s\S]*?(?:\\\)|$)|(?<!\\)\$(?!\s)(?:[^$\n\\]|\\.)+?(?<!\s)\$/g;

/** The text with each inline or display math replaced by MATH_PLACEHOLDER. */
export const replaceMath = (text: string): string => text.replace(MATH, MATH_PLACEHOLDER);

/** The message as plain text: code cells, markup and line breaks dropped, math as MATH_PLACEHOLDER unless `keepMath`. */
export function plainText(body: string, keepMath = false): string {
  const prose = body.replace(/```[\s\S]*?(?:```|$)/g, " ");
  return (keepMath ? prose : replaceMath(prose)).replace(/^[ \t]*(?:#+|>|[-*+]|\d+\.)[ \t]+/gm, "")
    .replace(keepMath ? /[*_`~]/g : /[*_`~]|\\(?=\$)/g, "").replace(/\s+/g, " ").trim();
}

