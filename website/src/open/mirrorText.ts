// The page's three-way text merge: core's line merge bound to node-diff3, which the /open/ bundle loads directly.
import { createTextMerge, type TextMerge, type TextMergeInput, type TextMergeResult } from "@labshelf/core";
import { diff3Merge } from "node-diff3";

const textMerge: TextMerge = createTextMerge(diff3Merge);

/** Merges `local` and `other` against `base` line by line; overlapping edits come back marked as conflicted. */
export function mirrorTextMerge(input: TextMergeInput): TextMergeResult {
  return textMerge(input);
}
