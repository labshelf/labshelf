// Diffs two texts line by line for the history view, folding long runs of unchanged lines.
export type DiffLineKind = "same" | "added" | "removed" | "gap";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Past this many cells of the LCS table the changed middle shows as fully removed then added. */
const MAX_CELLS = 4_000_000;
const CONTEXT = 3;

function middleDiff(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  }
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind: "same", text: a[i++]! }); j++; }
    // On a tie the removed line goes first, so a replaced line reads as old then new.
    else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) { out.push({ kind: "removed", text: a[i++]! }); }
    else { out.push({ kind: "added", text: b[j++]! }); }
  }
  return out;
}

// Keeps CONTEXT unchanged lines around each change and replaces the rest of a run with one gap line holding its count.
function foldUnchanged(lines: DiffLine[]): DiffLine[] {
  const keep = lines.map((line) => line.kind !== "same");
  lines.forEach((line, index) => {
    if (line.kind === "same") { return; }
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(lines.length - 1, index + CONTEXT); k++) { keep[k] = true; }
  });
  const out: DiffLine[] = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden > 0) { out.push({ kind: "gap", text: String(hidden) }); hidden = 0; }
      out.push(line);
    } else { hidden++; }
  });
  if (hidden > 0) { out.push({ kind: "gap", text: String(hidden) }); }
  return out;
}

export function compareLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split(/\r?\n/);
  const b = after === "" ? [] : after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) { start++; }
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) { end++; }
  const same = (text: string): DiffLine => ({ kind: "same", text });
  return foldUnchanged([
    ...a.slice(0, start).map(same),
    ...middleDiff(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...a.slice(a.length - end).map(same),
  ]);
}
