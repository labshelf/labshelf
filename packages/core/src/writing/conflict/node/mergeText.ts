// Binds the text merges to node-diff3 as Node loads it: line by line, and item by item for qmd item files.
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };
import { mergeItemFiles } from "../../../qmd/index.js";
import { isItemFileName } from "../mergeableTextFile.js";
import { createTextMerge } from "../../text/index.js";

// TRAP: node-diff3 ships ESM types only, so this CommonJS-compiled package cannot import it statically, and the
// `require` binding keeps this file Node-only; its `require` export is the CommonJS build Jest and the bundles load.
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;

export const mergeText = createTextMerge(diff3Merge);

// CONTRACT: documents/contracts/qmd-items.md#merge
/**
 * Merges by the file's kind. Only an item file merges without a base, as a union by id.
 * @throws when a file that is not an item file has no base
 */
export function mergeFileText(
  fileName: string, input: { base: string | undefined; local: string; other: string; otherLabel: string },
): { text: string; conflicted: boolean } {
  const { base, ...sides } = input;
  if (isItemFileName(fileName)) { return mergeItemFiles(base === undefined ? sides : { ...sides, base }, mergeText); }
  if (base === undefined) { throw new Error(`Cannot merge ${fileName} without a base`); }
  return mergeText({ ...sides, base });
}
