// Drawing layout (decision D3): one pass over a drawing model that computes label anchors, segment label sides,
// end shortening at labelled dot-less points, bends, axes boxes and ticks, and sampled function curves, all in grid units (y up).
import type { DrawingModel, Vec } from "./model.js";
import { parseExpr } from "./expr.js";
import { sampleFunction } from "./sample.js";

type Anchor = 'above' | 'above right' | 'right' | 'below right' | 'below' | 'below left' | 'left' | 'above left';

export interface LabelBox { width: number; height: number }

interface AxesLayout { origin: import("./model.js").Vec; from: import("./model.js").Vec; to: import("./model.js").Vec; xTicks: Array<{ at: import("./model.js").Vec; label: string }>; yTicks: Array<{ at: import("./model.js").Vec; label: string }> }

export interface DrawingLayout { points: Map<string, { x: number; y: number; anchor: Anchor }>; segments: Map<number, { from: import("./model.js").Vec; to: import("./model.js").Vec; side: 'left' | 'right'; bend: number }>; axes: Map<string, AxesLayout>; curves: Map<number, import("./model.js").Vec[][]> }

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

function layoutSegment(item: SegItem, a: DrawingPoint, b: DrawingPoint, centroid: Vec, measure: (tex: string) => LabelBox): { from: Vec; to: Vec; side: "left" | "right"; bend: number } {
  const side = item.side ?? sideFor(a, b, centroid);
  const bend = item.bend ?? 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < EPS) { return { from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y }, side, bend }; }
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const cap = len * MAX_SHORTEN_SHARE;
  const atStart = Math.min(shortening(a, ux, uy, measure), cap);
  const atEnd = Math.min(shortening(b, -ux, -uy, measure), cap);
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

/** The smallest 1-2-5 step that puts at most 10 ticks in [lo, hi] (which gives at least 4). */
function tickStep(lo: number, hi: number): number {
  const span = hi - lo;
  let power = 10 ** (Math.floor(Math.log10(span)) - 2);
  for (;;) {
    for (const m of [1, 2, 5]) {
      const step = m * power;
      const count = Math.floor(hi / step + EPS) - Math.ceil(lo / step - EPS) + 1;
      if (count <= 10) { return step; }
    }
    power *= 10;
  }
}

/** Tick values in [lo, hi] at the 1-2-5 step, without the zero tick. */
function tickValues(lo: number, hi: number): number[] {
  const step = tickStep(lo, hi);
  const out: number[] = [];
  for (let k = Math.ceil(lo / step - EPS); k <= Math.floor(hi / step + EPS); k += 1) {
    if (k !== 0) { out.push(k * step); }
  }
  return out;
}

function layoutAxes(item: AxesItem, o: Vec): AxesLayout {
  const grid = (mx: number, my: number): Vec => ({ x: o.x + mx * item.sx, y: o.y + my * item.sy });
  // The axis lines cross at math (0, 0), or at the nearest edge of the box when 0 is outside a range.
  const crossX = Math.min(item.x[1], Math.max(item.x[0], 0));
  const crossY = Math.min(item.y[1], Math.max(item.y[0], 0));
  return {
    origin: { x: o.x, y: o.y },
    from: grid(item.x[0], item.y[0]),
    to: grid(item.x[1], item.y[1]),
    xTicks: item.ticks ? tickValues(item.x[0], item.x[1]).map((v) => ({ at: grid(v, crossY), label: tickText(v) })) : [],
    yTicks: item.ticks ? tickValues(item.y[0], item.y[1]).map((v) => ({ at: grid(crossX, v), label: tickText(v) })) : [],
  };
}

function layoutCurve(item: FnItem, axes: AxesItem, o: Vec): Vec[][] {
  const parsed = parseExpr(item.expr);
  if (!parsed.ok) { return []; }
  const lo = Math.max(item.domain?.[0] ?? axes.x[0], axes.x[0]);
  const hi = Math.min(item.domain?.[1] ?? axes.x[1], axes.x[1]);
  if (!(hi > lo)) { return []; }
  return sampleFunction(parsed.evaluate, [lo, hi], axes.y).map((run) => run.map(([x, y]) => ({ x: o.x + x * axes.sx, y: o.y + y * axes.sy })));
}

export function layoutDrawing(model: import("./model.js").DrawingModel, measure: (tex: string) => LabelBox): DrawingLayout {
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
      if (o) { layout.axes.set(item.id, layoutAxes(item, o)); }
    } else if (item.k === "fn") {
      const axes = axesItems.get(item.axes);
      const o = axes ? byId.get(axes.o) : undefined;
      if (axes && o) { layout.curves.set(index, layoutCurve(item, axes, o)); }
    }
  });
  return layout;
}
