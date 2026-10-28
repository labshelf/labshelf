// Maps character offsets of a text to line numbers and finds where lines end.

/** The offset where each line of `text` starts. */
export function deriveLineOffsets(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) { starts.push(i + 1); }
  return starts;
}

/** The zero-based line holding `offset`: the last line start at or before it. */
export function findLineOfOffset(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) { low = mid; } else { high = mid - 1; }
  }
  return low;
}

/** The one-based line holding `offset`. */
export function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** The offset just after the next newline at or after `from`, or the text length when none follows. */
export function lineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline + 1;
}
