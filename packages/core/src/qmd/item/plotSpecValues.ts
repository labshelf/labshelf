// The number handling of the labshelf-plot spec: finite numbers rounded to 4 significant digits, null-gapped value columns and line decimation.
import type { PlotValue } from "./plotSpec.js";

export function round4(v: number): number {
  const r = Number(v.toPrecision(4));
  return r === 0 ? 0 : r;
}

/** A finite number rounded, or undefined when the value is not one. */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? round4(v) : undefined;
}

export function numbers(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: number[] = [];
  for (const item of v) {
    const n = num(item);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

export function values(v: unknown): PlotValue[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PlotValue[] = [];
  for (const item of v) {
    if (item === null) { out.push(null); continue; }
    const n = num(item);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

/** Keeps at most `limit` points: per index bucket the min and max y, a null where the bucket has a gap, and always the first and last points. */
export function decimate(columns: PlotValue[][], y: PlotValue[], limit: number): PlotValue[][] {
  const n = y.length;
  if (n <= limit) return columns;
  const buckets = limit / 2;
  const picked: number[] = [];
  const protectedIdx = new Set<number>([0, n - 1]);
  let gmin = -1;
  let gmax = -1;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * n) / buckets);
    const to = Math.floor(((b + 1) * n) / buckets);
    let lo = -1;
    let hi = -1;
    let gap = -1;
    for (let i = from; i < to; i++) {
      const v = y[i] as PlotValue;
      if (v === null) { if (gap < 0) gap = i; continue; }
      if (lo < 0 || v < (y[lo] as number)) lo = i;
      if (hi < 0 || v > (y[hi] as number)) hi = i;
    }
    if (lo >= 0 && (gmin < 0 || (y[lo] as number) < (y[gmin] as number))) gmin = lo;
    if (hi >= 0 && (gmax < 0 || (y[hi] as number) > (y[gmax] as number))) gmax = hi;
    if (gap >= 0) protectedIdx.add(gap);
    const set = new Set<number>();
    if (b === 0) set.add(0);
    if (b === buckets - 1) set.add(n - 1);
    if (lo >= 0) set.add(lo);
    if (hi >= 0) set.add(hi);
    if (gap >= 0) set.add(gap);
    for (const i of [...set].sort((a, c) => a - c)) picked.push(i);
  }
  if (gmin >= 0) protectedIdx.add(gmin);
  if (gmax >= 0) protectedIdx.add(gmax);
  let keep = picked;
  const excess = keep.length - limit;
  if (excess > 0) {
    const droppable = keep.filter((i) => !protectedIdx.has(i));
    const drop = new Set<number>();
    for (let j = 0; j < excess && j < droppable.length; j++) drop.add(droppable[Math.floor((j * droppable.length) / excess)] as number);
    keep = keep.filter((i) => !drop.has(i));
  }
  return columns.map((col) => keep.map((i) => col[i] as PlotValue));
}
