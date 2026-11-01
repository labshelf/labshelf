// Derives the `source` attribute that dates an inline math result against its expression and the code cells above it.
// CONTRACT: documents/contracts/qmd-items.md#inline-results
import { deriveTextSha256Hex } from "../../hash/index.js";
import { normaliseTex } from "../math/normaliseTex.js";

const SOURCE_LENGTH = 12;

/** The tex a result is dated by: normalised, without the trailing `=` or `\approx` that asks for the result. */
function expression(tex: string): string {
  return normaliseTex(tex).tex.replace(/\s*(?:=|\\approx)\s*$/, "").trim();
}

/**
 * The `source` attribute of an inline result: a hash of the expression and of every code cell above it, in note order.
 * Cells below the result are not in `cellsAbove`, so editing them leaves the source alone.
 * CONTRACT: documents/contracts/qmd-items.md#inline-results
 */
export async function deriveResultSource(tex: string, cellsAbove: readonly string[]): Promise<string> {
  // JSON quotes every string, so cells moved across a boundary ("ab","c" vs "a","bc") hash differently.
  const hashed = JSON.stringify([expression(tex), ...cellsAbove]);
  return (await deriveTextSha256Hex(hashed)).slice(0, SOURCE_LENGTH);
}
