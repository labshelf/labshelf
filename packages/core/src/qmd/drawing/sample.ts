// Adaptive sampler for plotted functions (decision D9): 64 equal intervals, midpoints at sharp turns
// and at the edge of the function's domain, runs broken at non-finite values and tall jumps, clipped to the range.

import { round4 } from "../item/plotSpecValues.js";

type Point = readonly [number, number];
type Sample = { x: number; y: number };

const BASE_INTERVALS = 64;
const MAX_DEPTH = 6;
const TURN_LIMIT = Math.PI / 36;
const DOMAIN_EDGE_SCORE = 1000;

function turnAngle(a: Sample, b: Sample, c: Sample, width: number, height: number): number {
  const ux = (b.x - a.x) / width;
  const uy = (b.y - a.y) / height;
  const vx = (c.x - b.x) / width;
  const vy = (c.y - b.y) / height;
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}

function intervalScore(samples: Sample[], i: number, width: number, height: number): number {
  const a = samples[i]!;
  const b = samples[i + 1]!;
  const aFinite = Number.isFinite(a.y);
  const bFinite = Number.isFinite(b.y);
  if (aFinite !== bFinite) { return DOMAIN_EDGE_SCORE; }
  if (!aFinite) { return 0; }
  let score = 0;
  const before = samples[i - 1];
  if (before !== undefined && Number.isFinite(before.y)) { score = Math.max(score, turnAngle(before, a, b, width, height)); }
  const after = samples[i + 2];
  if (after !== undefined && Number.isFinite(after.y)) { score = Math.max(score, turnAngle(a, b, after, width, height)); }
  return score > TURN_LIMIT ? score : 0;
}

function collectSamples(f: (x: number) => number, lo: number, hi: number, width: number, height: number, maxPoints: number): Sample[] {
  const step = (hi - lo) / BASE_INTERVALS;
  const samples: Sample[] = [];
  for (let i = 0; i <= BASE_INTERVALS; i += 1) {
    const x = i === BASE_INTERVALS ? hi : lo + step * i;
    samples.push({ x, y: f(x) });
  }
  const minWidth = step / 2 ** MAX_DEPTH;
  for (let pass = 0; pass < MAX_DEPTH; pass += 1) {
    const budget = maxPoints - samples.length;
    if (budget <= 0) { break; }
    const wanted: Array<{ index: number; score: number }> = [];
    for (let i = 0; i + 1 < samples.length; i += 1) {
      if (samples[i + 1]!.x - samples[i]!.x <= minWidth * 1.5) { continue; }
      const score = intervalScore(samples, i, width, height);
      if (score > 0) { wanted.push({ index: i, score }); }
    }
    if (wanted.length === 0) { break; }
    const chosen = wanted.sort((p, q) => q.score - p.score || p.index - q.index).slice(0, budget).sort((p, q) => q.index - p.index);
    for (const { index } of chosen) {
      const x = (samples[index]!.x + samples[index + 1]!.x) / 2;
      samples.splice(index + 1, 0, { x, y: f(x) });
    }
  }
  return samples;
}

function splitRuns(samples: Sample[], height: number): Sample[][] {
  const runs: Sample[][] = [];
  let current: Sample[] = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.y)) {
      if (current.length > 0) { runs.push(current); }
      current = [];
      continue;
    }
    const last = current[current.length - 1];
    if (last !== undefined && Math.abs(sample.y - last.y) > height) {
      runs.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 0) { runs.push(current); }
  return runs;
}

function crossing(from: Sample, to: Sample, y: number): Sample {
  return { x: from.x + ((y - from.y) / (to.y - from.y)) * (to.x - from.x), y };
}

function clipRun(run: Sample[], low: number, high: number): Sample[][] {
  const inside = (s: Sample): boolean => s.y >= low && s.y <= high;
  const bound = (s: Sample): number => (s.y > high ? high : low);
  const out: Sample[][] = [];
  let current: Sample[] = [];
  const flush = (): void => {
    if (current.length > 1) { out.push(current); }
    current = [];
  };
  run.forEach((sample, i) => {
    const previous = run[i - 1];
    if (previous === undefined) {
      if (inside(sample)) { current.push(sample); }
    } else if (inside(previous) && inside(sample)) {
      current.push(sample);
    } else if (inside(previous)) {
      current.push(crossing(previous, sample, bound(sample)));
      flush();
    } else if (inside(sample)) {
      current = [crossing(previous, sample, bound(previous)), sample];
    }
  });
  flush();
  return out;
}

export function sampleFunction(
  f: (x: number) => number,
  domain: readonly [number, number],
  range: readonly [number, number],
  maxPoints = 400,
): Array<Array<readonly [number, number]>> {
  const [lo, hi] = domain;
  const [low, high] = range;
  const height = high - low;
  const samples = collectSamples(f, lo, hi, hi - lo || 1, height || 1, maxPoints);
  return splitRuns(samples, height)
    .flatMap((run) => clipRun(run, low, high))
    .map((run) => run.map((s): Point => [round4(s.x), round4(s.y)]));
}
