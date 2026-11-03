// Drawing layout (decision D3): one pass over a drawing model that computes label anchors, segment label sides,
// end shortening at labelled dot-less points and at arrow tips on dots, tick steps whose labels keep clear of each other, bends, axes boxes and ticks, and sampled function curves, all in grid units (y up).
import type { DrawingModel, Vec } from "./drawingModel.js";
import { parseExpr } from "./expr.js";
import { sampleFunction } from "./sampleFunction.js";

type Anchor = 'above' | 'above right' | 'right' | 'below right' | 'below' | 'below left' | 'left' | 'above left';

export interface LabelBox { width: number; height: number }

interface AxesLayout { origin: import("./drawingModel.js").Vec; from: import("./drawingModel.js").Vec; to: import("./drawingModel.js").Vec; xTicks: Array<{ at: import("./drawingModel.js").Vec; label: string }>; yTicks: Array<{ at: import("./drawingModel.js").Vec; label: string }> }

export interface DrawingLayout { points: Map<string, { x: number; y: number; anchor: Anchor }>; segments: Map<number, { from: import("./drawingModel.js").Vec; to: import("./drawingModel.js").Vec; side: 'left' | 'right'; bend: number }>; axes: Map<string, AxesLayout>; curves: Map<number, import("./drawingModel.js").Vec[][]> }

type DrawingPoint = DrawingModel["points"][number];
type DrawingItem = DrawingModel["items"][number];
type SegItem = Extract<DrawingItem, { k: "seg" }>;
type AxesItem = Extract<DrawingItem, { k: "axes" }>;
type FnItem = Extract<DrawingItem, { k: "fn" }>;

/** Measured label boxes are in CSS pixels; one grid unit is 0.5cm (the TikZ header's x and y) at 96 px per inch. */
export const PX_PER_UNIT = (0.5 / 2.54) * 96;
/** Extra clearance, in pixels, between a shortened segment end and its label box. */
const LABEL_GAP_PX = 2;
/** A shortened end never eats more than this share of its segment. */
const MAX_SHORTEN_SHARE = 0.4;
const EPS = 1e-9;

/** Counter-clockwise from east, one per 45 degrees. */
const COMPASS: readonly Anchor[] = ["right", "above right", "above", "above left", "left", "below left", "below", "below right"];

/** model.ts stores an explicit `at` as a TikZ compass name. */
const AT_TO_ANCHOR: Readonly<Record<string, Anchor>> = {
  north: "above", south: "below", east: "right", west: "left",
  "north east": "above right", "north west": "above left", "south east": "below right", "south west": "below left",
};

function anchorFor(point: DrawingPoint, neighbours: Vec[]): Anchor {
  // `at` is a compass name in a validated model; an anchor name given directly is taken as is.
  const explicit = point.at === undefined ? undefined : AT_TO_ANCHOR[point.at] ?? COMPASS.find((a) => a === point.at);
  if (explicit) { return explicit; }
  let mx = 0;
  let my = 0;
  for (const n of neighbours) {
    const len = Math.hypot(n.x - point.x, n.y - point.y);
    if (len < EPS) { continue; }
    mx += (n.x - point.x) / len;
    my += (n.y - point.y) / len;
  }
  if (Math.hypot(mx, my) < EPS) { return "above right"; }
  const opposite = Math.atan2(-my, -mx);
  const index = ((Math.round(opposite / (Math.PI / 4)) % 8) + 8) % 8;
  return COMPASS[index]!;
}

/** The side away from the centroid; left of travel on a tie. */
function sideFor(a: Vec, b: Vec, centroid: Vec): "left" | "right" {
  const cross = (b.x - a.x) * (centroid.y - a.y) - (b.y - a.y) * (centroid.x - a.x);
  return cross > EPS ? "right" : "left";
}

/** How far, in grid units, a segment end at `p` stops short of it along the unit direction (ux, uy) pointing into the segment. */
function shortening(p: DrawingPoint, ux: number, uy: number, measure: (tex: string) => LabelBox): number {
  if (p.dot || p.label === undefined || p.label === "") { return 0; }
  const box = measure(p.label);
  const halfW = box.width / 2 + LABEL_GAP_PX;
  const halfH = box.height / 2 + LABEL_GAP_PX;
  const alongX = Math.abs(ux) < EPS ? Infinity : halfW / Math.abs(ux);
  const alongY = Math.abs(uy) < EPS ? Infinity : halfH / Math.abs(uy);
  const px = Math.min(alongX, alongY);
  return Number.isFinite(px) ? px / PX_PER_UNIT : 0;
}

/** How far, in grid units, an arrow tip stops short of a dotted point: the dot's radius plus a small gap. */
function arrowAtDot(p: DrawingPoint): number {
  return p.dot ? (DOT_RADIUS_PX + ARROW_DOT_GAP_PX) / PX_PER_UNIT : 0;
}

function layoutSegment(item: SegItem, a: DrawingPoint, b: DrawingPoint, centroid: Vec, measure: (tex: string) => LabelBox): { from: Vec; to: Vec; side: "left" | "right"; bend: number } {
  const side = item.side ?? sideFor(a, b, centroid);
  const bend = item.bend ?? 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < EPS) { return { from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y }, side, bend }; }
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const cap = len * MAX_SHORTEN_SHARE;
  const atStart = Math.min(shortening(a, ux, uy, measure) + (item.arrow === "both" ? arrowAtDot(a) : 0), cap);
  const atEnd = Math.min(shortening(b, -ux, -uy, measure) + (item.arrow === "end" || item.arrow === "both" ? arrowAtDot(b) : 0), cap);
  return {
    from: { x: a.x + ux * atStart, y: a.y + uy * atStart },
    to: { x: b.x - ux * atEnd, y: b.y - uy * atEnd },
    side,
    bend,
  };
}

/** A number as shortest decimal text, rounded to 1e-6, never -0. */
function tickText(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
}

/** Half a tick mark, in grid units, and the clearance, in px, between the mark and its label (svg.ts and tikz.ts draw them so). */
const TICK_UNITS = 0.15;
const TICK_LABEL_GAP_PX = 3;
/** Least clear space, in px, between two tick labels. */
const TICK_LABEL_SPACE_PX = 4;
/** Length, in px, of an axis arrowhead: no tick sits under it. */
const ARROW_PX = 8;
/** Radius, in px, of a point's dot (svg.ts 2px, tikz.ts 1.5pt) and the gap an arrow tip keeps from it. */
const DOT_RADIUS_PX = 2;
const ARROW_DOT_GAP_PX = 1.5;

/** One axis of an axes item: its math range, px per math unit, the math value where the other axis crosses it, and how a tick label's extent along the axis is measured. */
interface AxisSpec { lo: number; hi: number; pxPerUnit: number; cross: number; extent: (label: string) => number }

/** The 1-2-5 steps from the smallest that puts at most 10 ticks in [lo, hi] upwards, until one step spans the range. */
function* tickSteps(lo: number, hi: number): Generator<number> {
  const span = hi - lo;
  let power = 10 ** (Math.floor(Math.log10(span)) - 2);
  for (;;) {
    for (const m of [1, 2, 5]) {
      const step = m * power;
      const count = Math.floor(hi / step + EPS) - Math.ceil(lo / step - EPS) + 1;
      if (count <= 10) { yield step; }
      if (count <= 10 && step > span) { return; }
    }
    power *= 10;
  }
}

/** Tick values at `step` in [lo, hi], without the crossing (zero, or the edge where the other axis runs) and without a tick under the arrowhead. */
function tickValuesAt(axis: AxisSpec, step: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(axis.lo / step - EPS); k <= Math.floor(axis.hi / step + EPS); k += 1) {
    const v = k * step;
    if (k === 0 || Math.abs(v - axis.cross) < step * 1e-6 || (axis.hi - v) * axis.pxPerUnit < ARROW_PX) { continue; }
    out.push(v);
  }
  return out;
}

/** The ticks of the smallest 1-2-5 step whose labels, at their measured extent, keep clear of each other (fewer ticks on a short axis). */
function axisTicks(axis: AxisSpec): number[] {
  if (!(axis.hi > axis.lo) || !(axis.pxPerUnit > 0)) { return []; }
  let last: number[] = [];
  for (const step of tickSteps(axis.lo, axis.hi)) {
    const values = tickValuesAt(axis, step);
    last = values;
    const fits = values.every((v, i) => {
      const prev = values[i - 1];
      return prev === undefined || (v - prev) * axis.pxPerUnit >= (axis.extent(tickText(prev)) + axis.extent(tickText(v))) / 2 + TICK_LABEL_SPACE_PX;
    });
    if (fits) { return values; }
  }
  return last.length > 1 ? [] : last;
}

type Box = { x0: number; x1: number; y0: number; y1: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function layoutAxes(item: AxesItem, o: Vec, measure: (tex: string) => LabelBox): AxesLayout {
  const grid = (mx: number, my: number): Vec => ({ x: o.x + mx * item.sx, y: o.y + my * item.sy });
  // The axis lines cross at math (0, 0), or at the nearest edge of the box when 0 is outside a range.
  const crossX = Math.min(item.x[1], Math.max(item.x[0], 0));
  const crossY = Math.min(item.y[1], Math.max(item.y[0], 0));
  const layout: AxesLayout = { origin: { x: o.x, y: o.y }, from: grid(item.x[0], item.y[0]), to: grid(item.x[1], item.y[1]), xTicks: [], yTicks: [] };
  if (!item.ticks) { return layout; }
  const xs = axisTicks({ lo: item.x[0], hi: item.x[1], pxPerUnit: item.sx * PX_PER_UNIT, cross: crossX, extent: (label) => measure(label).width });
  const ys = axisTicks({ lo: item.y[0], hi: item.y[1], pxPerUnit: item.sy * PX_PER_UNIT, cross: crossY, extent: (label) => measure(label).height });
  // Label boxes in px, y up: x labels below their mark, y labels left of it. A y label that would overlap an x label near the crossing goes.
  const reach = TICK_UNITS * PX_PER_UNIT + TICK_LABEL_GAP_PX;
  const xBoxes = xs.map((v): Box => {
    const at = grid(v, crossY);
    const box = measure(tickText(v));
    return { x0: at.x * PX_PER_UNIT - box.width / 2, x1: at.x * PX_PER_UNIT + box.width / 2, y0: at.y * PX_PER_UNIT - reach - box.height, y1: at.y * PX_PER_UNIT - reach };
  });
  layout.xTicks = xs.map((v) => ({ at: grid(v, crossY), label: tickText(v) }));
  layout.yTicks = ys.map((v) => {
    const at = grid(crossX, v);
    const box = measure(tickText(v));
    const own: Box = { x0: at.x * PX_PER_UNIT - reach - box.width, x1: at.x * PX_PER_UNIT - reach, y0: at.y * PX_PER_UNIT - box.height / 2, y1: at.y * PX_PER_UNIT + box.height / 2 };
    return { at, label: xBoxes.some((other) => overlaps(own, other)) ? "" : tickText(v) };
  });
  return layout;
}

function layoutCurve(item: FnItem, axes: AxesItem, o: Vec): Vec[][] {
  const parsed = parseExpr(item.expr);
  if (!parsed.ok) { return []; }
  const lo = Math.max(item.domain?.[0] ?? axes.x[0], axes.x[0]);
  const hi = Math.min(item.domain?.[1] ?? axes.x[1], axes.x[1]);
  if (!(hi > lo)) { return []; }
  return sampleFunction(parsed.evaluate, [lo, hi], axes.y).map((run) => run.map(([x, y]) => ({ x: o.x + x * axes.sx, y: o.y + y * axes.sy })));
}

export function layoutDrawing(model: import("./drawingModel.js").DrawingModel, measure: (tex: string) => LabelBox): DrawingLayout {
  const byId = new Map(model.points.map((p) => [p.id, p]));
  const neighbours = new Map<string, Vec[]>(model.points.map((p) => [p.id, []]));
  const axesItems = new Map<string, AxesItem>();
  for (const item of model.items) {
    if (item.k === "axes") { axesItems.set(item.id, item); }
    if (item.k !== "seg" || item.a === item.b) { continue; }
    const a = byId.get(item.a);
    const b = byId.get(item.b);
    if (!a || !b) { continue; }
    neighbours.get(a.id)?.push(b);
    neighbours.get(b.id)?.push(a);
  }

  const n = model.points.length;
  const centroid: Vec = n === 0 ? { x: 0, y: 0 } : {
    x: model.points.reduce((s, p) => s + p.x, 0) / n,
    y: model.points.reduce((s, p) => s + p.y, 0) / n,
  };

  const layout: DrawingLayout = { points: new Map(), segments: new Map(), axes: new Map(), curves: new Map() };
  for (const p of model.points) {
    layout.points.set(p.id, { x: p.x, y: p.y, anchor: anchorFor(p, neighbours.get(p.id) ?? []) });
  }
  model.items.forEach((item, index) => {
    if (item.k === "seg") {
      const a = byId.get(item.a);
      const b = byId.get(item.b);
      if (a && b) { layout.segments.set(index, layoutSegment(item, a, b, centroid, measure)); }
    } else if (item.k === "axes") {
      const o = byId.get(item.o);
      if (o) { layout.axes.set(item.id, layoutAxes(item, o, measure)); }
    } else if (item.k === "fn") {
      const axes = axesItems.get(item.axes);
      const o = axes ? byId.get(axes.o) : undefined;
      if (axes && o) { layout.curves.set(index, layoutCurve(item, axes, o)); }
    }
  });
  return layout;
}
