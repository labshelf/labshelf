// What an open editor does with a text the Mirror file system hands it: the rebase onto the editor's current text and the cursor mapping.
import { mergeLocalFile, type TextMerge } from "@labshelf/core";

/**
 * The text an editor holding `current` shows after taking in `change`, or undefined when there is nothing to apply: the editor
 * already holds the new text, the merge changes nothing, or both sides edited the same lines (the editor keeps its text and its next send meets the 409 path).
 */
export function rebaseExternalText(path: string, current: string, change: { previous: string; text: string }, textMerge: TextMerge): string | undefined {
  if (current === change.previous) { return change.text === current ? undefined : change.text; }
  if (current === change.text) { return undefined; }
  const merged = mergeLocalFile({ path, base: change.previous, local: current, other: change.text }, textMerge);
  if (merged.conflict || merged.text === current) { return undefined; }
  return merged.text;
}

/** Where `cursor` of `before` goes in `after`, by their common start and end (the splice the editor applies): inside the changed middle it goes to the end of the inserted text. */
export function mapCursor(before: string, after: string, cursor: number): number {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) { start++; }
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) { end++; }
  if (cursor <= start) { return cursor; }
  if (cursor >= before.length - end) { return cursor + after.length - before.length; }
  return after.length - end;
}
