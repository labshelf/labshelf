/** The prose ranges the LaTeX and Typst scanners collect, and the URL skip both share. */

export interface ProseRange {
  from: number;
  to: number;
}

/** Collects prose characters into merged ranges in scan order. */
export class RangeCollector {
  readonly ranges: ProseRange[] = [];

  add(from: number, to: number): void {
    if (to <= from) return;
    const last = this.ranges[this.ranges.length - 1];
    if (last !== undefined && last.to >= from) last.to = Math.max(last.to, to);
    else this.ranges.push({ from, to });
  }
}

export function clip(ranges: readonly ProseRange[], from: number, to: number): ProseRange[] {
  const out: ProseRange[] = [];
  for (const range of ranges) {
    const a = Math.max(range.from, from);
    const b = Math.min(range.to, to);
    if (b > a) out.push({ from: a, to: b });
  }
  return out;
}

const URL_AT = /^(?:https?|ftp):\/\/[^\s{}<>()[\]"]+/;

export function urlLength(text: string, i: number): number {
  const char = text[i];
  if (char !== "h" && char !== "f") return 0;
  return URL_AT.exec(text.slice(i, i + 2000))?.[0].length ?? 0;
}
