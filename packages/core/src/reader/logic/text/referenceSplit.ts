/**
 * Splits reference-section lines into entries by the first boundary signal that applies: numbered markers, hanging
 * indent, extra vertical gaps, or an author-list opening. Deliberately conservative: ambiguous layouts yield no entries.
 */
import type { ReferenceEntry } from "./referenceList.js";
import type { TextLine } from "./textLines.js";

// "[12]", "(12)", "12." and "12)" — plus the mixed pairs OCR produces, such as "[12)" or "(12]".
const MARKER = /^(?:[[(]\s*([0-9lI|Oo]{1,3})\s*[\])]|([0-9lI|Oo]{1,3})[.)])(?=\s|$)/;

function markerNumber(text: string): number | null {
  const m = MARKER.exec(text);
  const token = m?.[1] ?? m?.[2];
  if (!token || !/\d/.test(token) && !/^[lI|]$/.test(token)) { return null; }
  const n = Number(token.replace(/[lI|]/g, "1").replace(/[Oo]/g, "0"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function appendLine(acc: string, next: string): string {
  if (!acc) { return next; }
  // A hyphen at a line end is almost always layout hyphenation in a reference list.
  if (/\p{L}-$/u.test(acc) && /^\p{Ll}/u.test(next)) { return acc.slice(0, -1) + next; }
  return `${acc} ${next}`;
}

// OCR reads a closing bracket as 1, l, I or |: "[71 ———, Dynamic data…" is entry 7. Only the list's own numbering can
// tell that from a real 71, so such a marker is accepted solely as the successor of the entry before it.
const LOOSE_MARKER = /^\[\s*([0-9lI|Oo]{1,2})[1lI|](?=\s)/;

function looseMarkerNumber(text: string, previous: number | null): number | null {
  const m = LOOSE_MARKER.exec(text);
  if (!m || previous === null) { return null; }
  return markerNumber(`[${m[1]!}]`) === previous + 1 ? previous + 1 : null;
}

function build(group: TextLine[], looseNumber: number | null = null): ReferenceEntry {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  let text = group.reduce((acc, l) => appendLine(acc, l.text), "");
  if (looseNumber !== null) { text = text.replace(LOOSE_MARKER, `[${looseNumber}]`); }
  return {
    text,
    number: looseNumber ?? markerNumber(first.text),
    column: first.column,
    x: first.x,
    yFirst: first.y,
    yLast: last.y,
    lineHeight: first.height,
  };
}

// "Silva, A. B." / "SILVA, Ana" / "Silva AB, Costa R." (Vancouver). The Vancouver form must be followed by another
// capitalised word, or "Revista X, v. 12" (a journal line) would read as an author.
const AUTHOR_START = /^\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){0,2}\s*,\s*\p{Lu}|^\p{Lu}[\p{L}'’\-]+\s+\p{Lu}{1,3}[,.]\s+\p{Lu}/u;

// Groups lines into entries, starting a new entry at every line `startsEntry` accepts.
function splitAt(lines: readonly TextLine[], startsEntry: (i: number) => boolean): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  let group: TextLine[] = [];
  lines.forEach((line, i) => {
    if (group.length > 0 && startsEntry(i)) { entries.push(build(group)); group = []; }
    group.push(line);
  });
  if (group.length > 0) { entries.push(build(group)); }
  return entries;
}

function splitByMarkers(lines: readonly TextLine[]): ReferenceEntry[] | null {
  if (lines.filter((l) => markerNumber(l.text) !== null).length < 2) { return null; }
  const entries: ReferenceEntry[] = [];
  let group: TextLine[] = [];
  let looseNumber: number | null = null;
  const flush = (): void => {
    if (group.length > 0) { entries.push(build(group, looseNumber)); }
    group = [];
    looseNumber = null;
  };
  let previous: number | null = null;
  for (const line of lines) {
    const strict = markerNumber(line.text);
    const loose: number | null = strict === null ? looseMarkerNumber(line.text, previous) : null;
    const number: number | null = strict ?? loose;
    if (number !== null) { flush(); previous = number; looseNumber = loose; }
    // Text before the first marker is a heading remnant or a page header.
    if (group.length > 0 || number !== null) { group.push(line); }
  }
  flush();
  return entries;
}

// Hanging indent: an entry's first line starts at the column's left edge, continuations are indented.
function splitByHangingIndent(lines: readonly TextLine[]): ReferenceEntry[] | null {
  const baseX = new Map<number, number>();
  for (const l of lines) { baseX.set(l.column, Math.min(baseX.get(l.column) ?? Infinity, l.x)); }
  const indented = lines.filter((l) => l.x > (baseX.get(l.column) ?? 0) + 4).length;
  if (indented < lines.length * 0.2) { return null; }
  return splitAt(lines, (i) => lines[i]!.x <= (baseX.get(lines[i]!.column) ?? 0) + 2);
}

// Block style (ABNT, many theses): entries are flush left and separated by extra vertical space.
function splitByGaps(lines: readonly TextLine[]): ReferenceEntry[] | null {
  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1]!.y - lines[i]!.y;
    if (lines[i - 1]!.column === lines[i]!.column && d > 0) { pitches.push(d); }
  }
  // The line pitch INSIDE an entry is the small one; a median would land on the gap between entries in a list of short entries.
  const sorted = [...pitches].sort((a, b) => a - b);
  const typical = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
  const isBreak = (i: number): boolean => {
    const prev = lines[i - 1]!;
    const line = lines[i]!;
    if (prev.column !== line.column) { return true; }
    return typical > 0 && prev.y - line.y > typical * 1.35;
  };
  const gapBreaks = lines.filter((_, i) => i > 0 && lines[i - 1]!.column === lines[i]!.column && isBreak(i)).length;
  if (gapBreaks < 2) { return null; }
  return splitAt(lines, (i) => i > 0 && isBreak(i));
}

// Last resort: a line that opens like an author list, right after a line that closed a sentence.
function splitByAuthorStart(lines: readonly TextLine[]): ReferenceEntry[] | null {
  const startsEntry = (i: number): boolean =>
    AUTHOR_START.test(lines[i]!.text) && (i === 0 || /[.)\]]\s*$/.test(lines[i - 1]!.text));
  if (lines.filter((_, i) => i > 0 && startsEntry(i)).length < 2) { return null; }
  return splitAt(lines, (i) => i > 0 && startsEntry(i));
}

/**
 * Splits reference-section lines (already in reading order) into entries.
 * Numbered lists split on their markers; unnumbered lists split on hanging indent. Anything else yields no entries.
 * @returns the entries, or [] when no reliable boundary signal exists.
 */
export function splitReferenceEntries(lines: readonly TextLine[]): ReferenceEntry[] {
  if (lines.length === 0) { return []; }
  return splitByMarkers(lines) ?? splitByHangingIndent(lines) ?? splitByGaps(lines) ?? splitByAuthorStart(lines) ?? [];
}
