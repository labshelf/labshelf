// Compares and merges texts line by line: line similarity for merge-base selection and the three-way merge marking overlaps.
import { countCommon } from "../../text/index.js";
import type { TextMerge } from "../../qmd/index.js";
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

/** Splits text into lines with line-ending differences excluded. */
function splitTextLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
}

/** Measures shared lines relative to the larger text, including repeated lines by occurrence. */
export function deriveLineSimilarity(a: string, b: string): number {
  const left = splitTextLines(a);
  const right = splitTextLines(b);
  const total = Math.max(left.length, right.length);
  if (total === 0) { return 1; }
  return countCommon(left, right) / total;
}

/** node-diff3's merge, injected because each runtime loads that package its own way. */
export type Diff3Merge = typeof NodeDiff3.diff3Merge;

/**
 * Non-overlapping edits merge; overlapping ones keep both sides in full between `<<<<<<< local`,
 * `=======` and `>>>>>>> <otherLabel>`. The same change on both sides is not a conflict.
 * The result takes local's line ending and its trailing-newline state.
 */
export function createTextMerge(diff3Merge: Diff3Merge): TextMerge {
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
