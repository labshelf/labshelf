// Reads `*` and `_` delimiter runs into em and strong marks, CommonMark style.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "../../schema/index.js";
import { type InlineToken, tokensToNodes } from "./inlineToken.js";
import { withMark, writesBackAs } from "./writesBack.js";

type Delimiter = Extract<InlineToken, { kind: "delim" }>;

const WHITESPACE = /\s/;
const PUNCTUATION = /[\p{P}\p{S}]/u;

/** Characters outside `[from, end)` count as whitespace, as at the edge of a paragraph or link text. */
export function delimiterRun(source: string, at: number, from: number, end: number): Delimiter {
  const char = source[at] ?? "";
  let length = 0;
  while (at + length < end && source[at + length] === char) length++;
  const before = at > from ? source[at - 1] ?? " " : " ";
  const after = at + length < end ? source[at + length] ?? " " : " ";
  const leftFlanking = !WHITESPACE.test(after) && (!PUNCTUATION.test(after) || WHITESPACE.test(before) || PUNCTUATION.test(before));
  const rightFlanking = !WHITESPACE.test(before) && (!PUNCTUATION.test(before) || WHITESPACE.test(after) || PUNCTUATION.test(after));
  // TRAP: `_` inside a word (snake_case_name) neither opens nor closes.
  const canOpen = char === "*" ? leftFlanking : leftFlanking && (!rightFlanking || PUNCTUATION.test(before));
  const canClose = char === "*" ? rightFlanking : rightFlanking && (!leftFlanking || PUNCTUATION.test(after));
  return { kind: "delim", char, count: length, length, canOpen, canClose, start: at, end: at + length };
}

function findOpener(tokens: readonly InlineToken[], closer: Delimiter, before: number): number {
  for (let index = before - 1; index >= 0; index--) {
    const opener = tokens[index];
    if (opener?.kind !== "delim" || !opener.canOpen || opener.char !== closer.char) continue;
    const sum = opener.length + closer.length;
    if ((opener.canClose || closer.canOpen) && sum % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0)) continue;
    return index;
  }
  return -1;
}

/** Wraps the tokens between opener and closer; returns the closer's index afterwards, or -1 when the pair does not write back. */
function pair(tokens: InlineToken[], source: string, openerIndex: number, closerIndex: number): number {
  const opener = tokens[openerIndex] as Delimiter;
  const closer = tokens[closerIndex] as Delimiter;
  const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
  const start = opener.end - use;
  const end = closer.start + use;
  const mark = qmdSchema.mark(use === 2 ? "strong" : "em", { marker: closer.char });
  const nodes = withMark(tokensToNodes(tokens.slice(openerIndex + 1, closerIndex)), mark);
  if (!writesBackAs(nodes, source.slice(start, end))) return -1;
  opener.count -= use;
  opener.end -= use;
  closer.count -= use;
  closer.start += use;
  tokens.splice(openerIndex + 1, closerIndex - openerIndex - 1, { kind: "nodes", nodes, start, end });
  let index = openerIndex + 2;
  if (opener.count === 0) {
    tokens.splice(openerIndex, 1);
    index--;
  }
  return index;
}

export function resolveEmphasis(tokens: InlineToken[], source: string): Node[] {
  for (let index = 0; index < tokens.length; index++) {
    const closer = tokens[index];
    if (closer?.kind !== "delim" || !closer.canClose || closer.count === 0) continue;
    const openerIndex = findOpener(tokens, closer, index);
    if (openerIndex < 0) continue;
    const closerIndex = pair(tokens, source, openerIndex, index);
    if (closerIndex < 0) continue;
    if (closer.count === 0) tokens.splice(closerIndex, 1);
    index = closerIndex - 1;
  }
  return tokensToNodes(tokens);
}
