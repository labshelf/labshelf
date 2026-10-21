// Measures shared lines relative to the larger text, including repeated lines by occurrence.
import { textLines } from "./textLines.js";

export function lineSimilarity(a: string, b: string): number {
  const left = textLines(a);
  const right = textLines(b);
  const total = Math.max(left.length, right.length);
  if (total === 0) { return 1; }
  const counts = new Map<string, number>();
  for (const line of left) { counts.set(line, (counts.get(line) ?? 0) + 1); }
  let equal = 0;
  for (const line of right) {
    const count = counts.get(line) ?? 0;
    if (count > 0) { equal += 1; counts.set(line, count - 1); }
  }
  return equal / total;
}
