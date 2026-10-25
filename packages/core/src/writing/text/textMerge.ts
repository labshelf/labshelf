// Merges two edited versions of a text against their common base, line by line, marking overlaps.
import { splitTextLines } from "./splitTextLines.js";
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

/** node-diff3's merge, injected because each runtime loads that package its own way. */
export type Diff3Merge = typeof NodeDiff3.diff3Merge;

export interface TextMergeInput {
  base: string;
  local: string;
  other: string;
  /** Names the other side in the closing conflict marker, e.g. the sync tool. */
  otherLabel: string;
}

export interface TextMergeResult {
  text: string;
  /** True when at least one overlapping edit is marked in the text. */
  conflicted: boolean;
}

/**
 * Non-overlapping edits merge; overlapping ones keep both sides in full between `<<<<<<< local`,
 * `=======` and `>>>>>>> <otherLabel>`. The same change on both sides is not a conflict.
 * The result takes local's line ending and its trailing-newline state.
 */
export function createTextMerge(diff3Merge: Diff3Merge): (input: TextMergeInput) => TextMergeResult {
  return ({ base, local, other, otherLabel }) => {
    const eol = local.includes("\r\n") ? "\r\n" : "\n";
    const out: string[] = [];
    let conflicted = false;
    for (const region of diff3Merge(splitTextLines(local), splitTextLines(base), splitTextLines(other), { excludeFalseConflicts: true })) {
      if (region.ok) {
        out.push(...region.ok);
      } else if (region.conflict) {
        conflicted = true;
        out.push("<<<<<<< local", ...region.conflict.a, "=======", ...region.conflict.b, `>>>>>>> ${otherLabel}`);
      }
    }
    const trailing = local.endsWith("\n") && out.length > 0 ? eol : "";
    return { text: out.join(eol) + trailing, conflicted };
  };
}
