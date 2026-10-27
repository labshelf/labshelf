// Measures shared lines relative to the larger text, including repeated lines by occurrence.
import { countCommon } from "../../text/index.js";
import { splitTextLines } from "./splitTextLines.js";

export function deriveLineSimilarity(a: string, b: string): number {
  const left = splitTextLines(a);
  const right = splitTextLines(b);
  const total = Math.max(left.length, right.length);
  if (total === 0) { return 1; }
  return countCommon(left, right) / total;
}
