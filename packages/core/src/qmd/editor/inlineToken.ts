// Holds the tokens the inline scanner produces and turns them into ProseMirror nodes.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "./schema/index.js";

/** `start`/`end` are source offsets of the bytes the token still stands for. */
export type InlineToken =
  | { kind: "text"; text: string; start: number; end: number }
  | { kind: "nodes"; nodes: Node[]; start: number; end: number }
  | { kind: "delim"; char: string; count: number; length: number; canOpen: boolean; canClose: boolean; start: number; end: number };

export function addText(tokens: InlineToken[], text: string, start: number): void {
  const last = tokens[tokens.length - 1];
  if (last?.kind === "text") {
    last.text += text;
    last.end = start + text.length;
  } else {
    tokens.push({ kind: "text", text, start, end: start + text.length });
  }
}

export function deriveTokenNodes(tokens: readonly InlineToken[]): Node[] {
  return tokens.flatMap((token) => {
    if (token.kind === "nodes") return token.nodes;
    const text = token.kind === "text" ? token.text : token.char.repeat(token.count);
    return text ? [qmdSchema.text(text)] : [];
  });
}
