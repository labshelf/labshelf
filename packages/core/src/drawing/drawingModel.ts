// The labshelf-drawing model v1: the JSON a drawing block carries so the editor can reopen and edit it; validates it (ids, ranges, finite numbers), rounds coordinates to 0.01 and writes it on one line.
// CONTRACT: documents/contracts/qmd-items.md#drawings
import { isRecord as isObj } from "../guards/index.js";
import type { Ctrl } from "./drawingPath.js";

export interface Vec { x: number; y: number }

export interface DrawingStyle { color?: string; dash?: 'dashed' | 'dotted'; thick?: boolean; fill?: string; opacity?: number }

/** The outline a point drawn as a node gets around its label (graph vertices, diagram boxes). */
export type NodeShape = 'circle' | 'box' | 'round' | 'ellipse' | 'diamond';
export const NODE_SHAPES: readonly NodeShape[] = ["circle", "box", "round", "ellipse", "diamond"];

/** Control points of one curve piece relative to its two ends: [dx1, dy1, dx2, dy2]; null keeps the automatic smooth ones. */
type CurveCtrl = Ctrl | null;

interface DrawingPoint { id: string; x: number; y: number; label?: string; at?: string; dot: boolean; on?: { item: number; x: number }; shape?: NodeShape; style?: DrawingStyle }

type DrawingItem = { k: 'seg'; a: string; b: string; arrow: 'none' | 'end' | 'both'; bend?: number; label?: string; side?: 'left' | 'right'; marks?: number; style?: DrawingStyle }
  | { k: 'curve'; pts: string[]; closed: boolean; ctrl?: CurveCtrl[]; arrow?: 'end' | 'both'; style?: DrawingStyle }
  | { k: 'ngon'; c: string; r: number; n: number; rot: number; star?: number; style?: DrawingStyle }
  | { k: 'ellipse'; c: string; rx: number; ry: number; rot?: number; style?: DrawingStyle }
  | { k: 'arc'; c: string; r: number; from: number; to: number; close?: 'sector' | 'chord'; arrow?: 'end' | 'both'; style?: DrawingStyle }
  | { k: 'angle'; a: string; o: string; b: string; r?: number; arcs?: number; label?: string; style?: DrawingStyle }
  | { k: 'circle'; c: string; r: number; style?: DrawingStyle } | { k: 'rect'; a: string; b: string; style?: DrawingStyle } | { k: 'poly'; pts: string[]; closed: boolean; style?: DrawingStyle } | { k: 'text'; x: number; y: number; tex: string } | { k: 'axes'; id: string; o: string; x: [number, number]; y: [number, number]; sx: number; sy: number; ticks: boolean; xlabel?: string; ylabel?: string } | { k: 'fn'; axes: string; expr: string; domain?: [number, number]; label?: string; style?: DrawingStyle }

export interface DrawingModel { v: 1; points: DrawingPoint[]; items: DrawingItem[] }

/** The eight TikZ compass anchors a point label may sit at. */
const DRAWING_ANCHORS: readonly string[] = ["north", "south", "east", "west", "north east", "north west", "south east", "south west"];

type Obj = Record<string, unknown>;

/** Thrown inside the reader to reject the whole model. */
class Invalid extends Error {}

function fail(): never {
  throw new Invalid();
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fail();
}

/** A coordinate rounded to 0.01, never -0. */
function coord(value: unknown): number {
  const out = Math.round(finite(value) * 100) / 100;
  return out === 0 ? 0 : out;
}

function positive(value: unknown): number {
  const out = finite(value);
  return out > 0 ? out : fail();
}

function str(value: unknown): string {
  return typeof value === "string" ? value : fail();
}

function id(value: unknown): string {
  const out = str(value);
  return out !== "" ? out : fail();
}

function bool(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return allowed.includes(value as T) ? value as T : fail();
}

/** A rounded [lo, hi] range with lo < hi. */
function range(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) { fail(); }
  const lo = coord(value[0]);
  const hi = coord(value[1]);
  return lo < hi ? [lo, hi] : fail();
}

/** Copies the optional fields present in `value` through their reader, in the given order. */
function optional(out: Obj, value: Obj, fields: [string, (v: unknown) => unknown][]): void {
  for (const [key, read] of fields) {
    if (value[key] !== undefined) { out[key] = read(value[key]); }
  }
}

/** An integer in [lo, hi]. */
function int(value: unknown, lo: number, hi: number): number {
  const out = finite(value);
  return Number.isInteger(out) && out >= lo && out <= hi ? out : fail();
}

/** A number strictly between 0 and 1, rounded to 0.01. */
function share(value: unknown): number {
  const out = coord(value);
  return out > 0 && out < 1 ? out : fail();
}

const ARROW_ENDS = ["end", "both"] as const;

function curveCtrl(value: unknown): CurveCtrl {
  if (value === null) { return null; }
  if (!Array.isArray(value) || value.length !== 4) { fail(); }
  return value.map(coord) as Ctrl;
}

function style(value: unknown): DrawingStyle | undefined {
  if (!isObj(value)) { fail(); }
  const out: Obj = {};
  optional(out, value, [["color", str], ["dash", (v) => oneOf(v, ["dashed", "dotted"] as const)], ["thick", bool], ["fill", str], ["opacity", share]]);
  return Object.keys(out).length > 0 ? out as DrawingStyle : undefined;
}

function withStyle(out: Obj, value: Obj): Obj {
  if (value.style !== undefined) {
    const s = style(value.style);
    if (s) { out.style = s; }
  }
  return out;
}

function readPoint(value: unknown): DrawingPoint {
  if (!isObj(value)) { fail(); }
  const out: Obj = { id: id(value.id), x: coord(value.x), y: coord(value.y) };
  optional(out, value, [["label", str], ["at", (v) => oneOf(v, DRAWING_ANCHORS)]]);
  out.dot = bool(value.dot);
  if (value.on !== undefined) {
    const on = value.on;
    if (!isObj(on) || typeof on.item !== "number" || !Number.isInteger(on.item) || on.item < 0) { fail(); }
    out.on = { item: on.item, x: coord(on.x) };
  }
  optional(out, value, [["shape", (v) => oneOf(v, NODE_SHAPES)]]);
  return withStyle(out, value) as unknown as DrawingPoint;
}

function readItem(value: unknown): DrawingItem {
  if (!isObj(value)) { fail(); }
  switch (value.k) {
    case "seg": {
      const out: Obj = { k: "seg", a: id(value.a), b: id(value.b), arrow: oneOf(value.arrow, ["none", "end", "both"] as const) };
      optional(out, value, [["bend", finite], ["label", str], ["side", (v) => oneOf(v, ["left", "right"] as const)], ["marks", (v) => int(v, 1, 3)]]);
      return withStyle(out, value) as DrawingItem;
    }
    case "circle":
      return withStyle({ k: "circle", c: id(value.c), r: coord(positive(value.r)) }, value) as DrawingItem;
    case "rect":
      return withStyle({ k: "rect", a: id(value.a), b: id(value.b) }, value) as DrawingItem;
    case "poly": {
      if (!Array.isArray(value.pts) || value.pts.length < 2) { fail(); }
      return withStyle({ k: "poly", pts: value.pts.map(id), closed: bool(value.closed) }, value) as DrawingItem;
    }
    case "text":
      return { k: "text", x: coord(value.x), y: coord(value.y), tex: str(value.tex) };
    case "axes": {
      const out: Obj = { k: "axes", id: id(value.id), o: id(value.o), x: range(value.x), y: range(value.y), sx: positive(value.sx), sy: positive(value.sy), ticks: bool(value.ticks) };
      optional(out, value, [["xlabel", str], ["ylabel", str]]);
      return out as DrawingItem;
    }
    case "fn": {
      const out: Obj = { k: "fn", axes: id(value.axes), expr: str(value.expr) };
      optional(out, value, [["domain", range], ["label", str]]);
      return withStyle(out, value) as DrawingItem;
    }
    default:
      return readShapeItem(value);
  }
}

/** Reads a curve, regular polygon, ellipse, arc or angle mark; fails on any other kind. */
function readShapeItem(value: Obj): DrawingItem {
  switch (value.k) {
    case "curve": {
      if (!Array.isArray(value.pts) || value.pts.length < 2) { fail(); }
      const out: Obj = { k: "curve", pts: value.pts.map(id), closed: bool(value.closed) };
      if (value.ctrl !== undefined) {
        const pieces = out.closed && value.pts.length > 2 ? value.pts.length : value.pts.length - 1;
        if (!Array.isArray(value.ctrl) || value.ctrl.length !== pieces) { fail(); }
        out.ctrl = value.ctrl.map(curveCtrl);
      }
      optional(out, value, [["arrow", (v) => oneOf(v, ARROW_ENDS)]]);
      return withStyle(out, value) as DrawingItem;
    }
    case "ngon": {
      const out: Obj = { k: "ngon", c: id(value.c), r: coord(positive(value.r)), n: int(value.n, 3, 24), rot: coord(value.rot) };
      optional(out, value, [["star", share]]);
      return withStyle(out, value) as DrawingItem;
    }
    case "ellipse": {
      const out: Obj = { k: "ellipse", c: id(value.c), rx: coord(positive(value.rx)), ry: coord(positive(value.ry)) };
      optional(out, value, [["rot", coord]]);
      return withStyle(out, value) as DrawingItem;
    }
    case "arc": {
      const out: Obj = { k: "arc", c: id(value.c), r: coord(positive(value.r)), from: coord(value.from), to: coord(value.to) };
      if (!((out.to as number) > (out.from as number) && (out.to as number) - (out.from as number) <= 360)) { fail(); }
      optional(out, value, [["close", (v) => oneOf(v, ["sector", "chord"] as const)], ["arrow", (v) => oneOf(v, ARROW_ENDS)]]);
      return withStyle(out, value) as DrawingItem;
    }
    case "angle": {
      const out: Obj = { k: "angle", a: id(value.a), o: id(value.o), b: id(value.b) };
      optional(out, value, [["r", (v) => coord(positive(v))], ["arcs", (v) => int(v, 1, 3)], ["label", str]]);
      return withStyle(out, value) as DrawingItem;
    }
    default:
      return fail();
  }
}

/** The point ids an item names. */
export function pointRefs(item: DrawingItem): string[] {
  switch (item.k) {
    case "seg": case "rect": return [item.a, item.b];
    case "circle": return [item.c];
    case "poly": case "curve": return item.pts;
    case "ngon": case "ellipse": case "arc": return [item.c];
    case "angle": return [item.a, item.o, item.b];
    case "axes": return [item.o];
    default: return [];
  }
}

/** The item with every point id it names passed through `map` (the inverse of pointRefs). */
export function mapRefs(item: DrawingItem, map: (id: string) => string): DrawingItem {
  switch (item.k) {
    case "seg": case "rect": return { ...item, a: map(item.a), b: map(item.b) };
    case "circle": case "ngon": case "ellipse": case "arc": return { ...item, c: map(item.c) };
    case "poly": case "curve": return { ...item, pts: item.pts.map(map) };
    case "angle": return { ...item, a: map(item.a), o: map(item.o), b: map(item.b) };
    case "axes": return { ...item, o: map(item.o) };
    default: return item;
  }
}

/** Rejects duplicate ids (points and axes share one namespace), dangling point and axes ids, and an `on` that names no fn item. */
function checkRefs(points: DrawingPoint[], items: DrawingItem[]): void {
  const ids = new Set<string>();
  const add = (name: string): void => {
    if (ids.has(name)) { fail(); }
    ids.add(name);
  };
  points.forEach((p) => add(p.id));
  const pointIds = new Set(ids);
  const axesIds = new Set<string>();
  for (const item of items) {
    if (item.k === "axes") { add(item.id); axesIds.add(item.id); }
  }
  for (const item of items) {
    if (pointRefs(item).some((ref) => !pointIds.has(ref))) { fail(); }
    if (item.k === "fn" && !axesIds.has(item.axes)) { fail(); }
  }
  for (const p of points) {
    if (p.on && items[p.on.item]?.k !== "fn") { fail(); }
  }
}

/** Validates a labshelf-drawing v1 value and returns it normalised (rounded, canonical key order, unknown keys dropped), or null. Never throws. */
function readDrawingModel(value: unknown): DrawingModel | null {
  try {
    if (!isObj(value) || value.v !== 1 || !Array.isArray(value.points) || !Array.isArray(value.items)) { return null; }
    const points = value.points.map(readPoint);
    const items = value.items.map(readItem);
    checkRefs(points, items);
    return { v: 1, points, items };
  } catch (error) {
    if (error instanceof Invalid) { return null; }
    throw error;
  }
}

/** A drawing with nothing in it, which Done removes instead of saving. */
export const isEmptyDrawingModel = (model: DrawingModel): boolean => model.points.length === 0 && model.items.length === 0;

/** JSON.parse then validation; null when the text is not JSON or not a valid v1 model. The fn `expr` is kept unparsed. */
export function parseDrawingModel(json: string): DrawingModel | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  return readDrawingModel(value);
}

/** The model as one line of JSON in canonical key order; a model that does not validate is written as given. */
export function formatDrawingModel(model: DrawingModel): string {
  return JSON.stringify(readDrawingModel(model) ?? model);
}
