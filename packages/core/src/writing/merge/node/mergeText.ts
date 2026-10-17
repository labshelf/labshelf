// Merges two edited versions of a text against their common base, line by line, marking overlaps.
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

// TRAP: node-diff3 ships ESM types only, so this CommonJS-compiled package cannot import it statically, and the
// `require` binding keeps this file Node-only; its `require` export is the CommonJS build Jest and the bundles load.
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;

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

/** Splits into lines without the final line ending, so a trailing-newline difference alone is no change. */
function lines(text: string): string[] {
  return text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
}

/**
 * Non-overlapping edits merge; overlapping ones keep both sides in full between `<<<<<<< local`,
 * `=======` and `>>>>>>> <otherLabel>`. The same change on both sides is not a conflict.
 * The result takes local's line ending and its trailing-newline state.
 */
export function mergeText({ base, local, other, otherLabel }: TextMergeInput): TextMergeResult {
  const eol = local.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  let conflicted = false;
  for (const region of diff3Merge(lines(local), lines(base), lines(other), { excludeFalseConflicts: true })) {
    if (region.ok) {
      out.push(...region.ok);
    } else if (region.conflict) {
      conflicted = true;
      out.push("<<<<<<< local", ...region.conflict.a, "=======", ...region.conflict.b, `>>>>>>> ${otherLabel}`);
    }
  }
  const trailing = local.endsWith("\n") && out.length > 0 ? eol : "";
  return { text: out.join(eol) + trailing, conflicted };
}
