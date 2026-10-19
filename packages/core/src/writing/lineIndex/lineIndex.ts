// Maps character offsets of a text to zero-based line numbers.

/** The offset where each line of `text` starts. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) { starts.push(i + 1); }
  return starts;
}

/** The zero-based line holding `offset`: the last line start at or before it. */
export function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) { low = mid; } else { high = mid - 1; }
  }
  return low;
}
