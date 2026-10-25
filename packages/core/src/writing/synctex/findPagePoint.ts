// Finds where a source line appears in the output.
import type { PagePoint } from "../../reader/index.js";
import { normalizeInputPath } from "./normalizeInputPath.js";
import type { SynctexMap } from "./synctexMap.js";

/** First index of `lines` (ascending) that is >= `line`. */
function firstAtLeast(lines: readonly number[], line: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((lines[middle] ?? 0) < line) { low = middle + 1; } else { high = middle; }
  }
  return low;
}

/**
 * The top-most position of the file's line on its first page. A line that produced no output maps to the next line that did,
 * or to the last one before it when none follows. `undefined` when the build did not typeset the file.
 */
export function findPagePoint(index: SynctexMap, file: string, line: number): PagePoint | undefined {
  const entry = index.byFile.get(normalizeInputPath(file, "/"));
  if (!entry || entry.lines.length === 0) { return undefined; }
  const at = firstAtLeast(entry.lines, line);
  const matched = entry.lines[at] ?? entry.lines[entry.lines.length - 1];
  const position = matched === undefined ? undefined : entry.positions.get(matched);
  return position && { page: position.page, x: position.x, y: position.y };
}
