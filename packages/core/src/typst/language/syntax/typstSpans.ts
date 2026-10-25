// Finds where a Typst comment, raw span or string literal that starts at an offset ends.

/** Where the comment at `start` ends (a line comment ends at its newline), or -1 when it runs to the end of the text. */
export function commentEnd(text: string, start: number): number {
  if (text[start + 1] === "/") { return text.indexOf("\n", start); }
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "/" && text[i + 1] === "*") { depth++; i++; continue; }
    if (text[i] === "*" && text[i + 1] === "/") {
      depth--; i++;
      if (depth === 0) { return i + 1; }
    }
  }
  return -1;
}

/** Where the raw span opened by the backticks at `start` ends, or -1 when it runs to the end of the text. */
export function rawEnd(text: string, start: number): number {
  let ticks = 0;
  while (text[start + ticks] === "`") { ticks++; }
  // TRAP: exactly two backticks are an empty raw span, not the opening of one.
  if (ticks === 2) { return start + 2; }
  const close = text.indexOf("`".repeat(ticks), start + ticks);
  return close < 0 ? -1 : close + ticks;
}

/** The offset of the quote closing the string opened at `start`, or -1 when the string runs to the end of the text. */
export function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === '"') { return i; }
  }
  return -1;
}
