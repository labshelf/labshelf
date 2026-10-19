// Walks Typst text through its markup, code and math modes, reporting identifiers, labels and strings.
import { codeStep } from "./typstCodeStep.js";
import { openEmbed, openFrame, popFrame, type TypstFrame, type TypstWalk, type TypstWalkEnd, type TypstWalkEvents } from "./typstFrames.js";
import { skipCommentOrRaw, skipString } from "./typstSkip.js";

const LABEL = /<([\p{L}\p{N}_\-:.]+)>/uy;

function pushEmbed(w: TypstWalk): void {
  w.i++;
  w.stack.push(openEmbed());
}

function markupStep(w: TypstWalk, top: TypstFrame): void {
  if (skipCommentOrRaw(w, true)) { return; }
  const ch = w.text[w.i];
  if (ch === "\\") { w.i += 2; return; }
  if (ch === "#") { pushEmbed(w); return; }
  if (ch === "$" || ch === "[") {
    w.stack.push(openFrame(ch === "$" ? "math" : "markup", ch === "$" ? "$" : "]"));
    w.i++;
    return;
  }
  if (ch === "]" && top.closer === "]") { w.i++; popFrame(w, ch); return; }
  LABEL.lastIndex = w.i;
  const label = LABEL.exec(w.text);
  if (label) {
    w.events.label?.(label[1]!, w.i + 1, LABEL.lastIndex - 1);
    w.i = LABEL.lastIndex;
    return;
  }
  w.i++;
}

function mathStep(w: TypstWalk, top: TypstFrame): void {
  if (skipCommentOrRaw(w, false)) { return; }
  const ch = w.text[w.i];
  if (ch === "\\") { w.i += 2; return; }
  if (ch === "$" && top.closer === "$") { w.i++; popFrame(w, ch); return; }
  if (ch === "#") { pushEmbed(w); return; }
  if (ch === "\"") { skipString(w, undefined); return; }
  w.i++;
}

/** Walks the whole text and returns where it ends: the open frames and any unclosed comment, raw span or string. */
export function walkTypst(text: string, events: TypstWalkEvents = {}): TypstWalkEnd {
  const w: TypstWalk = { text, events, i: 0, stack: [openFrame("markup", "")], inComment: false, inRaw: false };
  while (w.i < text.length) {
    const top = w.stack[w.stack.length - 1]!;
    if (top.mode === "code") { codeStep(w, top); }
    else if (top.mode === "math") { mathStep(w, top); }
    else { markupStep(w, top); }
  }
  return w;
}
