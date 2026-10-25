// Steps a Typst walk over a comment, raw span or string literal, noting when the text ends inside one.
import type { TypstWalk } from "./typstFrames.js";
import { commentEnd, rawEnd, stringEnd } from "./typstSpans.js";

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
