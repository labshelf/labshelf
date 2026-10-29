/**
 * Runtime-neutral placement of a text box on a page. Every input and output is in page fractions (0..1 on each axis,
 * origin top-left); text rects are gathered from the live text layer by the caller.
 */

export interface PageRect { x: number; y: number; w: number; h: number }

const MAX_W = 0.4;
const MAX_H = 0.25;
const MIN_W = 0.05;
const MIN_H = 0.03;
const SNAP = 0.01;
const EPS = 1e-9;

/** Rounds a fraction to 4 decimals (the anchor contract). */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Builds a rounded rect from its edges, so `x + w` stays on the rounded right edge. */
function fromEdges(left: number, top: number, right: number, bottom: number): PageRect {
  const x = round4(left);
  const y = round4(top);
  return { x, y, w: round4(round4(right) - x), h: round4(round4(bottom) - y) };
}

function overlaps(a: PageRect, b: PageRect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

/**
 * Free vertical span, through the point's y, of the column `[left, right]`.
 * @returns null when a text rect in the column covers the point's y.
 */
function freeSpan(left: number, right: number, py: number, rects: readonly PageRect[]): { top: number; bottom: number } | null {
  let top = 0;
  let bottom = 1;
  for (const r of rects) {
    if (!(r.x < right - EPS && r.x + r.w > left + EPS)) continue;
    if (r.y + r.h <= py + EPS) top = Math.max(top, r.y + r.h);
    else if (r.y >= py - EPS) bottom = Math.min(bottom, r.y);
    else return null;
  }
  return { top, bottom };
}

/**
 * Largest box around a point that overlaps no text, capped at 0.4 by 0.25 of the page.
 * @returns null when the point is on text or the free area is smaller than 0.05 by 0.03.
 */
export function fitEmptyBox(point: { x: number; y: number }, rects: readonly PageRect[]): PageRect | null {
  const px = clamp(point.x, 0, 1);
  const py = clamp(point.y, 0, 1);
  if (rects.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)) return null;

  const lefts = [0, ...rects.map((r) => r.x + r.w)].filter((v) => v >= 0 && v <= px + EPS);
  const rights = [1, ...rects.map((r) => r.x)].filter((v) => v <= 1 && v >= px - EPS);

  // Candidate columns: the point-centred window first so ties keep the box centred on the point.
  const columns: Array<[number, number]> = [];
  for (const left of lefts) {
    for (const right of rights) {
      if (right - left <= MAX_W + EPS) {
        columns.push([left, right]);
        continue;
      }
      const maxStart = right - MAX_W;
      const starts = [
        clamp(px - MAX_W / 2, left, maxStart),
        left,
        maxStart,
        ...rects.map((r) => r.x + r.w),
        ...rects.map((r) => r.x - MAX_W),
      ];
      for (const start of starts) {
        if (start < left - EPS || start > maxStart + EPS) continue;
        if (start > px + EPS || start + MAX_W < px - EPS) continue;
        columns.push([start, start + MAX_W]);
      }
    }
  }

  let best: { left: number; right: number; top: number; bottom: number; area: number } | null = null;
  for (const [left, right] of columns) {
    const span = freeSpan(left, right, py, rects);
    if (!span) continue;
    let { top, bottom } = span;
    if (bottom - top > MAX_H) {
      top = clamp(py - MAX_H / 2, top, bottom - MAX_H);
      bottom = top + MAX_H;
    }
    const area = (right - left) * (bottom - top);
    if (!best || area > best.area + EPS) best = { left, right, top, bottom, area };
  }
  if (!best) return null;
  const box = fromEdges(best.left, best.top, best.right, best.bottom);
  if (box.w < MIN_W - EPS || box.h < MIN_H - EPS) return null;
  return box;
}

/** Moves the rect off one overlapping text rect on the side where the overlap is smallest. */
function shrinkOff(box: PageRect, text: PageRect): PageRect {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const sides = [
    { amount: text.x + text.w - box.x, apply: (): PageRect => ({ ...box, x: text.x + text.w, w: right - (text.x + text.w) }) },
    { amount: right - text.x, apply: (): PageRect => ({ ...box, w: text.x - box.x }) },
    { amount: text.y + text.h - box.y, apply: (): PageRect => ({ ...box, y: text.y + text.h, h: bottom - (text.y + text.h) }) },
    { amount: bottom - text.y, apply: (): PageRect => ({ ...box, h: text.y - box.y }) },
  ];
  const pick = sides.reduce((least, side) => (side.amount < least.amount ? side : least));
  return pick.apply();
}

/** Nearest target within the snap distance, or the value itself. */
function snapValue(value: number, targets: readonly number[]): number {
  let best = value;
  let distance = SNAP + EPS;
  for (const target of targets) {
    const d = Math.abs(target - value);
    if (d < distance) {
      best = target;
      distance = d;
    }
  }
  return best;
}

/**
 * Snaps a dragged box: it is first shrunk off any text it overlaps (on the smallest-overlap side), then each edge
 * within 0.01 of the page edge or a text rect edge moves onto it, leaving the opposite edge in place.
 * @returns the rect with every fraction rounded to 4 decimals.
 */
export function snapBox(rect: PageRect, rects: readonly PageRect[]): PageRect {
  let box: PageRect = { ...rect };
  for (let pass = 0; pass < rects.length; pass++) {
    const hit = rects.find((r) => box.w > EPS && box.h > EPS && overlaps(box, r));
    if (!hit) break;
    box = shrinkOff(box, hit);
  }

  const xs = [0, 1, ...rects.flatMap((r) => [r.x, r.x + r.w])];
  const ys = [0, 1, ...rects.flatMap((r) => [r.y, r.y + r.h])];
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  const clear = (l: number, t: number, r: number, b: number): boolean =>
    r > l && b > t && !rects.some((text) => overlaps({ x: l, y: t, w: r - l, h: b - t }, text));

  const snappedLeft = snapValue(left, xs);
  if (clear(snappedLeft, top, right, bottom)) left = snappedLeft;
  const snappedRight = snapValue(right, xs);
  if (clear(left, top, snappedRight, bottom)) right = snappedRight;
  const snappedTop = snapValue(top, ys);
  if (clear(left, snappedTop, right, bottom)) top = snappedTop;
  const snappedBottom = snapValue(bottom, ys);
  if (clear(left, top, right, snappedBottom)) bottom = snappedBottom;

  return fromEdges(left, top, right, bottom);
}
