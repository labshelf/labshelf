// Finds code spans and inline math at a position of the inline source.
// CONTRACT: documents/contracts/qmd-items.md#format

const WHITESPACE = /\s/;

function runLength(source: string, at: number, char: string, end: number): number {
  let length = 0;
  while (at + length < end && source[at + length] === char) length++;
  return length;
}

/** INVARIANT: neither construct crosses a line ending, so text nodes never hold "\n". */
export function matchCodeSpan(source: string, at: number, end: number): { ticks: number; code: string; end: number } | { ticks: number } {
  const ticks = runLength(source, at, "`", end);
  let index = at + ticks;
  while (index < end && source[index] !== "\n") {
    if (source[index] !== "`") { index++; continue; }
    const run = runLength(source, index, "`", end);
    if (run === ticks) return { ticks, code: source.slice(at + ticks, index), end: index + run };
    index += run;
  }
  return { ticks };
}

/** Pandoc rules: the opening `$` is not followed by whitespace, the closing one is not preceded by whitespace nor followed by a digit. */
export function matchMath(source: string, at: number, end: number): { tex: string; end: number } | null {
  const first = source[at + 1];
  if (first === undefined || at + 1 >= end || first === "$" || WHITESPACE.test(first)) return null;
  for (let index = at + 1; index < end && source[index] !== "\n"; index++) {
    if (source[index] === "\\") {
      if (source[index + 1] === "\n") return null;
      index++;
      continue;
    }
    if (source[index] !== "$") continue;
    const after = index + 1 < end ? source[index + 1] ?? "" : "";
    if (!WHITESPACE.test(source[index - 1] ?? "") && !/[0-9]/.test(after)) return { tex: source.slice(at + 1, index), end: index + 1 };
  }
  return null;
}
