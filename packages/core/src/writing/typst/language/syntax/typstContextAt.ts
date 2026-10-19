// Tells what surrounds a cursor in Typst text: the mode, the word being typed and the string or call it is in.
import type { TypstCursorContext } from "./typstSyntaxTypes.js";
import { innermostCall, walkTypst } from "./walk/index.js";

const WORD_CHAR = /[\p{L}\p{N}_-]/u;
const TRIGGERS = new Set(["#", "@", "<", "."]);
const RECEIVER = /[\p{L}_][\p{L}\p{N}_-]*(?:\.[\p{L}_][\p{L}\p{N}_-]*)*$/u;
/** How far before the dot a receiver path is looked for. */
const RECEIVER_SPAN = 200;

export function typstContextAt(text: string, offset: number): TypstCursorContext {
  const before = text.slice(0, offset);
  const end = walkTypst(before);
  let from = offset;
  while (from > 0 && WORD_CHAR.test(before[from - 1]!)) { from--; }
  const mark = before[from - 1] ?? "";
  const trigger = TRIGGERS.has(mark) ? (mark as TypstCursorContext["trigger"]) : "";
  const context: TypstCursorContext = {
    mode: end.stack[end.stack.length - 1]!.mode,
    inComment: end.inComment,
    inRaw: end.inRaw,
    word: { from, text: before.slice(from) },
    trigger,
  };
  const receiver = trigger === "." ? RECEIVER.exec(before.slice(Math.max(0, from - 1 - RECEIVER_SPAN), from - 1))?.[0] : undefined;
  if (receiver !== undefined) { context.receiver = receiver; }
  if (end.string) {
    context.string = { from: end.string.from, prefix: before.slice(end.string.from) };
    if (end.string.call !== undefined) { context.string.call = end.string.call; }
  }
  const call = innermostCall(end.stack);
  if (call) { context.call = call; }
  return context;
}
