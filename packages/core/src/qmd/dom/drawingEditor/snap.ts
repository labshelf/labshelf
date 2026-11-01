// Snapping and alignment guides for the drawing editor (decision D8): pure functions in grid units, y up; nearest point or function curve within 8 px, then 15° with Shift, then the grid; Alt turns it all off.
import { parseExpr, type DrawingModel, type Vec } from "../../drawing/index.js";

interface Guide { axis: 'h' | 'v'; at: number }

export interface SnapInput { x: number; y: number; from?: import("../../drawing/index.js").Vec; shift: boolean; alt: boolean; scale: number }

export interface SnapResult { x: number; y: number; pointId?: string; curve?: { item: number; x: number }; guides: Guide[] }

/** Pointer distance, in px, within which an existing point or a function curve captures the position. */
const SNAP_PX = 8;
/** Distance, in px, within which another point's x or y draws an alignment guide. */
const GUIDE_PX = 4;
/** Step of the Shift direction snap. */
const ANGLE_STEP = Math.PI / 12;
/** Equal intervals the curve search samples before refining the best one. */
const CURVE_SAMPLES = 1000;
const REFINE_STEPS = 40;

interface CurveHit { item: number; x: number; pos: Vec; dist: number }

/** The nearest point of one fn item to the position, in grid units, or undefined when the item cannot be plotted. */
function nearestOnCurve(model: DrawingModel, itemIndex: number, at: Vec): CurveHit | undefined {
  const item = model.items[itemIndex];
  if (item === undefined || item.k !== "fn") { return undefined; }
  const axes = model.items.find((candidate) => candidate.k === "axes" && candidate.id === item.axes);
  if (axes === undefined || axes.k !== "axes") { return undefined; }
  const origin = model.points.find((point) => point.id === axes.o);
  if (origin === undefined) { return undefined; }
  const parsed = parseExpr(item.expr);
  if (!parsed.ok) { return undefined; }
  const [lo, hi] = item.domain ?? axes.x;
  const evaluate = parsed.evaluate;
  const gridAt = (mathX: number): Vec | undefined => {
    const mathY = evaluate(mathX);
    if (!Number.isFinite(mathY)) { return undefined; }
    return { x: origin.x + mathX * axes.sx, y: origin.y + mathY * axes.sy };
  };
  const distanceAt = (mathX: number): number => {
    const pos = gridAt(mathX);
    return pos === undefined ? Infinity : Math.hypot(pos.x - at.x, pos.y - at.y);
  };
  const step = (hi - lo) / CURVE_SAMPLES;
  if (!(step > 0)) { return undefined; }
  let bestX = lo;
  let bestDist = Infinity;
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const mathX = lo + i * step;
    const dist = distanceAt(mathX);
    if (dist < bestDist) { bestDist = dist; bestX = mathX; }
  }
  if (bestDist === Infinity) { return undefined; }
  let a = Math.max(lo, bestX - step);
  let b = Math.min(hi, bestX + step);
  for (let i = 0; i < REFINE_STEPS; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (distanceAt(m1) < distanceAt(m2)) { b = m2; } else { a = m1; }
  }
  const refinedX = (a + b) / 2;
  const refinedDist = distanceAt(refinedX);
  const finalX = refinedDist <= bestDist ? refinedX : bestX;
  const pos = gridAt(finalX);
  if (pos === undefined) { return undefined; }
  return { item: itemIndex, x: finalX, pos, dist: Math.min(refinedDist, bestDist) };
}

function alignmentGuides(model: DrawingModel, at: Vec, scale: number, skip: ReadonlySet<string>): Guide[] {
  const limit = GUIDE_PX / scale;
  const guides: Guide[] = [];
  const add = (axis: 'h' | 'v', pos: number): void => {
    if (!guides.some((guide) => guide.axis === axis && guide.at === pos)) { guides.push({ axis, at: pos }); }
  };
  for (const point of model.points) {
    if (skip.has(point.id)) { continue; }
    if (Math.abs(point.x - at.x) <= limit) { add('v', point.x); }
    if (Math.abs(point.y - at.y) <= limit) { add('h', point.y); }
  }
  return guides;
}

/** Snaps a pointer position: existing point, then function curve, then 15° from `from` with Shift, then the grid; Alt returns the position untouched. */
export function snapPosition(model: DrawingModel, input: SnapInput, ignore?: ReadonlySet<string>): SnapResult {
  if (input.alt) { return { x: input.x, y: input.y, guides: [] }; }
  const skip = ignore ?? new Set<string>();
  const at: Vec = { x: input.x, y: input.y };
  const limit = SNAP_PX / input.scale;

  let nearestPoint: { id: string; pos: Vec; dist: number } | undefined;
  for (const point of model.points) {
    if (skip.has(point.id)) { continue; }
    const dist = Math.hypot(point.x - at.x, point.y - at.y);
    if (dist <= limit && (nearestPoint === undefined || dist < nearestPoint.dist)) {
      nearestPoint = { id: point.id, pos: { x: point.x, y: point.y }, dist };
    }
  }
  if (nearestPoint !== undefined) {
    const pos = nearestPoint.pos;
    return { x: pos.x, y: pos.y, pointId: nearestPoint.id, guides: alignmentGuides(model, pos, input.scale, new Set([...skip, nearestPoint.id])) };
  }

  let nearestCurve: CurveHit | undefined;
  for (let index = 0; index < model.items.length; index++) {
    const hit = nearestOnCurve(model, index, at);
    if (hit !== undefined && hit.dist <= limit && (nearestCurve === undefined || hit.dist < nearestCurve.dist)) { nearestCurve = hit; }
  }
  if (nearestCurve !== undefined) {
    return { x: nearestCurve.pos.x, y: nearestCurve.pos.y, curve: { item: nearestCurve.item, x: nearestCurve.x }, guides: alignmentGuides(model, nearestCurve.pos, input.scale, skip) };
  }

  let snapped: Vec;
  if (input.shift && input.from !== undefined) {
    const dx = input.x - input.from.x;
    const dy = input.y - input.from.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.round(Math.atan2(dy, dx) / ANGLE_STEP) * ANGLE_STEP;
    snapped = { x: input.from.x + length * Math.cos(angle), y: input.from.y + length * Math.sin(angle) };
  } else {
    snapped = { x: Math.round(input.x), y: Math.round(input.y) };
  }
  return { x: snapped.x, y: snapped.y, guides: alignmentGuides(model, snapped, input.scale, skip) };
}
