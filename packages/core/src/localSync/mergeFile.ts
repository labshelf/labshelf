// Merges a file's local text with another app's text against their base: qmd item by item, other text line by line, and an overlapping conflict keeps the local side and hands back the other side as a conflict copy.
// CONTRACT: documents/contracts/local-sync.md#merge
import { conflictCopyPath } from "../library/conflicts/conflictCopy.js";
import { isItemFileName } from "../library/conflicts/mergeBase.js";
import { mergeItemFiles, type TextMerge, type TextMergeResult } from "../qmd/item/mergeItemFiles.js";

export interface LocalFileMergeInput { readonly path: string; readonly base: string; readonly local: string; readonly other: string }

export interface LocalFileMerge { readonly text: string; readonly conflict?: { readonly copyPath: string; readonly text: string } }

const OTHER_LABEL = "other";

function mergeText(input: LocalFileMergeInput, textMerge: TextMerge): TextMergeResult {
  const merge = { base: input.base, local: input.local, other: input.other, otherLabel: OTHER_LABEL };
  if (!isItemFileName(input.path)) { return textMerge(merge); }
  try { return mergeItemFiles(merge, textMerge); } catch { return textMerge(merge); }
}

/**
 * The file text after taking in the other app's edits. A merge with an overlapping conflict is never written: the file
 * keeps the local side and the other side comes back to be written to a conflict copy.
 * @param copyId only makes the copy path predictable; without it the path gets a random UUID.
 */
export function mergeLocalFile(input: LocalFileMergeInput, textMerge: TextMerge, copyId?: string): LocalFileMerge {
  if (input.local === input.other || input.other === input.base) { return { text: input.local }; }
  if (input.local === input.base) { return { text: input.other }; }
  const merged = mergeText(input, textMerge);
  if (!merged.conflicted) { return { text: merged.text }; }
  return { text: input.local, conflict: { copyPath: conflictCopyPath(input.path, copyId), text: input.other } };
}
