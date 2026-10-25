// Merges one item that is present on both sides of a merge: opening line, cell results and body.
// CONTRACT: documents/contracts/qmd-items.md#merge
import { isBalanced, lineEnding, splitLines, unclosedCodeFences, type ItemSegment } from "../items/index.js";
import { mergeOpeners } from "./attributeMerge.js";
import { settleOutputs } from "./outputMerge.js";
import { changedSide } from "./sideChange.js";
import type { TextMerge } from "./textMergePort.js";

/** The bytes of a merged item, written as they are. */
export type ItemText = Pick<ItemSegment, "fence" | "body" | "close">;

export interface ItemMergeResult {
  readonly items: readonly ItemText[];
  readonly conflicted: boolean;
}

/**
 * Both-sided body edits merge line by line, with conflict markers inside the body only. When the merged body would
 * open or close a fence it does not close or open, both versions are kept as two items with the same id.
 */
export function mergeItem(
  base: ItemSegment | undefined, local: ItemSegment, other: ItemSegment, textMerge: TextMerge, otherLabel: string,
): ItemMergeResult {
  const fence = changedSide(base?.fence, local.fence, other.fence) ?? mergeOpeners(base?.fence, local.fence, other.fence);
  const settled = settleOutputs(local.body, other.body);
  const body = changedSide(base?.body, settled.local, settled.other);
  if (body !== undefined) { return { items: [{ fence, body, close: local.close }], conflicted: false }; }
  const merged = textMerge({ base: base?.body ?? "", local: settled.local, other: settled.other, otherLabel });
  const text = merged.text === "" || /[\r\n]$/.test(merged.text) ? merged.text : merged.text + lineEnding(local.fence);
  const lines = splitLines(text);
  if (!isBalanced(lines) || unclosedCodeFences(lines).length > 0) {
    return { items: [local, other], conflicted: true };
  }
  return { items: [{ fence, body: text, close: local.close }], conflicted: merged.conflicted };
}
