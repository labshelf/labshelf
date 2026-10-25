// Steps a Typst walk over a comment, raw span or string literal, noting when the text ends inside one.
import type { TypstWalk } from "./typstFrames.js";

/** Where the comment at `start` ends (a line comment ends at its newline), or -1 when it runs to the end of the text. */
function commentEnd(text: string, start: number): number {
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
function rawEnd(text: string, start: number): number {
  let ticks = 0;
  while (text[start + ticks] === "`") { ticks++; }
  // TRAP: exactly two backticks are an empty raw span, not the opening of one.
  if (ticks === 2) { return start + 2; }
  const close = text.indexOf("`".repeat(ticks), start + ticks);
  return close < 0 ? -1 : close + ticks;
}

/** The offset of the quote closing the string opened at `start`, or -1 when the string runs to the end of the text. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === '"') { return i; }
  }
  return -1;
}

/** Skips the comment or raw span at the walk's offset; false when none starts there. */
export function skipCommentOrRaw(w: TypstWalk, inMarkup: boolean): boolean {
  const { text, i } = w;
  const isComment = text[i] === "/" && (text[i + 1] === "*" || text[i + 1] === "/");
  // TRAP: in markup `//` right after `:` belongs to a URL such as https://x.org, not a line comment.
  if (isComment && !(inMarkup && text[i + 1] === "/" && text[i - 1] === ":")) {
    const end = commentEnd(text, i);
    if (end < 0) { w.inComment = true; w.i = text.length; } else { w.i = end; }
    return true;
  }
  if (text[i] !== "`") { return false; }
  const end = rawEnd(text, i);
  if (end < 0) { w.inRaw = true; w.i = text.length; } else { w.i = end; }
  return true;
}

/** Skips the string literal opened at the walk's offset and reports it with the call it belongs to. */
export function skipString(w: TypstWalk, call: string | undefined): void {
  const close = stringEnd(w.text, w.i);
  const from = w.i + 1;
  if (close < 0) {
    w.string = { from, call };
    w.i = w.text.length;
    return;
  }
  w.events.string?.(w.text.slice(from, close), from, close, call);
  w.i = close + 1;
}
