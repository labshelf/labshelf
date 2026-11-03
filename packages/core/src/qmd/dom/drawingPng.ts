// PNG painter (decision D11): paints the restricted SVG of a drawing on a canvas, black on white, and returns a data URL. It never
// loads an image: paths and glyphs go through Path2D, so no img-src or blob: is needed under any host CSP. The subset painted is the
// one sanitize.ts allows, and anything the sanitizer rejects is rejected here too.
import { sanitizeDrawingSvg } from "./drawingSanitize.js";

/** The canvas the host provides: `document.createElement("canvas")` in the DOM, @napi-rs/canvas in Node. */
export interface CanvasFactory {
  create(width: number, height: number): { getContext(kind: "2d"): CanvasRenderingContext2D | null; toDataURL(type: "image/png"): string };
}

const DEFAULT_SCALE = 3;
/** Same approximation of the font units of a label as svg.ts: an `ex` is 8 px and an `em` 16 px. */
const EX = 8;
const MAX_SIDE = 16384;
const MAX_DEPTH = 64;
const BLACK = "#000000";

interface Style {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  miter: number;
  dash: number[];
  dashOffset: number;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  evenOdd: boolean;
}

/** Nothing is painted unless set: no fill, no stroke. */
const ROOT_STYLE: Style = {
  fill: null, stroke: null, strokeWidth: 1, cap: "butt", join: "miter", miter: 4, dash: [], dashOffset: 0,
  fillOpacity: 1, strokeOpacity: 1, opacity: 1, evenOdd: false,
};

interface Run {
  ctx: CanvasRenderingContext2D;
  ids: Map<string, Element>;
  /** The `use` elements being expanded, to stop a reference cycle. */
  active: Set<Element>;
}

function num(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) { return fallback; }
  const v = Number.parseFloat(value);
  return Number.isFinite(v) ? v : fallback;
}

function length(value: string | null): number | undefined {
  const m = /^\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|ex|em)?\s*$/i.exec(value ?? "");
  if (!m) { return undefined; }
  const v = Number(m[1]);
  const unit = m[2]?.toLowerCase();
  return unit === "ex" ? v * EX : unit === "em" ? v * EX * 2 : v;
}

function numbers(value: string | null | undefined): number[] {
  return (value ?? "").split(/[\s,]+/).filter((s) => s !== "").map(Number).filter(Number.isFinite);
}

/** A paint value as a canvas colour, or null for no paint (none, a url reference, an empty value). */
function colour(value: string | null, inherited: string | null): string | null {
  if (value === null) { return inherited; }
  const v = value.trim();
  if (v === "" || v === "none" || /^url\(/i.test(v)) { return null; }
  if (v === "inherit") { return inherited; }
  return /^currentcolor$/i.test(v) ? BLACK : v;
}

function styleOf(el: Element, parent: Style): Style {
  const attr = (name: string) => el.getAttribute(name);
  const cap = attr("stroke-linecap");
  const join = attr("stroke-linejoin");
  const dash = attr("stroke-dasharray");
  return {
    fill: colour(attr("fill"), parent.fill),
    stroke: colour(attr("stroke"), parent.stroke),
    strokeWidth: num(attr("stroke-width"), parent.strokeWidth),
    cap: cap === "butt" || cap === "round" || cap === "square" ? cap : parent.cap,
    join: join === "miter" || join === "round" || join === "bevel" ? join : parent.join,
    miter: num(attr("stroke-miterlimit"), parent.miter),
    dash: dash === null ? parent.dash : dash.trim() === "none" ? [] : numbers(dash),
    dashOffset: num(attr("stroke-dashoffset"), parent.dashOffset),
    fillOpacity: num(attr("fill-opacity"), parent.fillOpacity),
    strokeOpacity: num(attr("stroke-opacity"), parent.strokeOpacity),
    opacity: parent.opacity * num(attr("opacity"), 1),
    evenOdd: attr("fill-rule") === null ? parent.evenOdd : attr("fill-rule") === "evenodd",
  };
}

function applyTransform(ctx: CanvasRenderingContext2D, value: string | null): void {
  if (value === null) { return; }
  for (const m of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = numbers(m[2]);
    const at = (i: number, fallback: number) => a[i] ?? fallback;
    switch (m[1]) {
      case "translate": ctx.translate(at(0, 0), at(1, 0)); break;
      case "scale": ctx.scale(at(0, 1), at(1, at(0, 1))); break;
      case "rotate": {
        const cx = at(1, 0);
        const cy = at(2, 0);
        ctx.translate(cx, cy);
        ctx.rotate((at(0, 0) * Math.PI) / 180);
        ctx.translate(-cx, -cy);
        break;
      }
      case "matrix": ctx.transform(at(0, 1), at(1, 0), at(2, 0), at(3, 1), at(4, 0), at(5, 0)); break;
      case "skewX": ctx.transform(1, 0, Math.tan((at(0, 0) * Math.PI) / 180), 1, 0, 0); break;
      case "skewY": ctx.transform(1, Math.tan((at(0, 0) * Math.PI) / 180), 0, 1, 0, 0); break;
      default: break;
    }
  }
}

/** Maps the viewBox of an svg element onto a width by height box at the origin (xMidYMid meet, the SVG default). */
function fitViewBox(ctx: CanvasRenderingContext2D, el: Element, width: number, height: number): void {
  const vb = numbers(el.getAttribute("viewBox"));
  const [vx, vy, vw, vh] = vb;
  if (vb.length !== 4 || vx === undefined || vy === undefined || !vw || !vh || vw <= 0 || vh <= 0) { return; }
  const s = Math.min(width / vw, height / vh);
  ctx.translate((width - vw * s) / 2, (height - vh * s) / 2);
  ctx.scale(s, s);
  ctx.translate(-vx, -vy);
}

function fillAndStroke(run: Run, st: Style, path?: Path2D): void {
  const { ctx } = run;
  const rule: CanvasFillRule = st.evenOdd ? "evenodd" : "nonzero";
  if (st.fill !== null) {
    ctx.fillStyle = st.fill;
    ctx.globalAlpha = st.opacity * st.fillOpacity;
    if (path) { ctx.fill(path, rule); } else { ctx.fill(rule); }
  }
  if (st.stroke !== null && st.strokeWidth > 0) {
    ctx.strokeStyle = st.stroke;
    ctx.globalAlpha = st.opacity * st.strokeOpacity;
    ctx.lineWidth = st.strokeWidth;
    ctx.lineCap = st.cap;
    ctx.lineJoin = st.join;
    ctx.miterLimit = st.miter;
    ctx.setLineDash(st.dash.length % 2 === 1 ? [...st.dash, ...st.dash] : st.dash);
    ctx.lineDashOffset = st.dashOffset;
    if (path) { ctx.stroke(path); } else { ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}

function pointPath(ctx: CanvasRenderingContext2D, el: Element, close: boolean): boolean {
  const v = numbers(el.getAttribute("points"));
  if (v.length < 4) { return false; }
  ctx.beginPath();
  for (let i = 0; i + 1 < v.length; i += 2) {
    if (i === 0) { ctx.moveTo(v[0] as number, v[1] as number); } else { ctx.lineTo(v[i] as number, v[i + 1] as number); }
  }
  if (close) { ctx.closePath(); }
  return true;
}

function paintShape(run: Run, el: Element, st: Style): void {
  const { ctx } = run;
  const attr = (name: string) => num(el.getAttribute(name), 0);
  switch (el.localName) {
    case "path": {
      const d = el.getAttribute("d");
      if (d !== null && d.trim() !== "") { fillAndStroke(run, st, new Path2D(d)); }
      return;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(attr("x1"), attr("y1"));
      ctx.lineTo(attr("x2"), attr("y2"));
      // A line has no interior.
      fillAndStroke(run, { ...st, fill: null });
      return;
    case "circle": {
      const r = attr("r");
      if (r <= 0) { return; }
      ctx.beginPath();
      ctx.arc(attr("cx"), attr("cy"), r, 0, 2 * Math.PI);
      fillAndStroke(run, st);
      return;
    }
    case "rect": {
      const w = attr("width");
      const h = attr("height");
      if (w <= 0 || h <= 0) { return; }
      ctx.beginPath();
      ctx.rect(attr("x"), attr("y"), w, h);
      fillAndStroke(run, st);
      return;
    }
    case "polygon":
      if (pointPath(ctx, el, true)) { fillAndStroke(run, st); }
      return;
    case "polyline":
      if (pointPath(ctx, el, false)) { fillAndStroke(run, st); }
      return;
    default:
      return;
  }
}

function paintChildren(run: Run, el: Element, st: Style, depth: number): void {
  for (const child of Array.from(el.children)) { paintElement(run, child, st, depth + 1); }
}

function paintUse(run: Run, el: Element, st: Style, depth: number): void {
  const href = el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "";
  const target = href.startsWith("#") ? run.ids.get(href.slice(1)) : undefined;
  if (!target || run.active.has(el)) { return; }
  run.active.add(el);
  try {
    run.ctx.translate(num(el.getAttribute("x"), 0), num(el.getAttribute("y"), 0));
    paintElement(run, target, st, depth + 1);
  } finally {
    run.active.delete(el);
  }
}

function paintNestedSvg(run: Run, el: Element, st: Style, depth: number): void {
  const { ctx } = run;
  ctx.translate(num(el.getAttribute("x"), 0), num(el.getAttribute("y"), 0));
  const vb = numbers(el.getAttribute("viewBox"));
  const width = length(el.getAttribute("width")) ?? vb[2] ?? 0;
  const height = length(el.getAttribute("height")) ?? vb[3] ?? 0;
  fitViewBox(ctx, el, width, height);
  paintChildren(run, el, st, depth);
}

function paintElement(run: Run, el: Element, parent: Style, depth: number): void {
  if (depth > MAX_DEPTH) { return; }
  const name = el.localName;
  if (name === "defs" || name === "title") { return; }
  const { ctx } = run;
  ctx.save();
  try {
    applyTransform(ctx, el.getAttribute("transform"));
    const st = styleOf(el, parent);
    if (name === "g") { paintChildren(run, el, st, depth); }
    else if (name === "svg") { paintNestedSvg(run, el, st, depth); }
    else if (name === "use") { paintUse(run, el, st, depth); }
    else { paintShape(run, el, st); }
  } finally {
    ctx.restore();
  }
}

function collectIds(root: Element): Map<string, Element> {
  const ids = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id");
    if (id !== null && !ids.has(id)) { ids.set(id, el); }
  }
  return ids;
}

function parseRoot(svg: string): Element | null {
  const clean = sanitizeDrawingSvg(svg);
  if (clean === null) { return null; }
  try {
    const root = new DOMParser().parseFromString(clean, "image/svg+xml").documentElement as Element | null;
    return root && root.localName === "svg" ? root : null;
  } catch {
    return null;
  }
}

/**
 * Paints the drawing SVG at `scale` times its size, black on a white background, and returns the PNG as a data URL.
 * Null when the markup is not a drawing SVG the sanitizer accepts, or the canvas cannot be made.
 */
export function paintDrawingPng(svg: string, canvas: CanvasFactory, scale: number = DEFAULT_SCALE): string | null {
  const root = parseRoot(svg);
  if (root === null || !(scale > 0)) { return null; }
  const vb = numbers(root.getAttribute("viewBox"));
  const width = length(root.getAttribute("width")) ?? vb[2];
  const height = length(root.getAttribute("height")) ?? vb[3];
  if (width === undefined || height === undefined || !(width > 0) || !(height > 0)) { return null; }
  const pixelsW = Math.max(1, Math.round(width * scale));
  const pixelsH = Math.max(1, Math.round(height * scale));
  if (pixelsW > MAX_SIDE || pixelsH > MAX_SIDE) { return null; }

  const surface = canvas.create(pixelsW, pixelsH);
  const ctx = surface.getContext("2d");
  if (!ctx) { return null; }
  try {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pixelsW, pixelsH);
    ctx.scale(pixelsW / width, pixelsH / height);
    fitViewBox(ctx, root, width, height);
    const run: Run = { ctx, ids: collectIds(root), active: new Set() };
    paintChildren(run, root, styleOf(root, ROOT_STYLE), 0);
    return surface.toDataURL("image/png");
  } catch {
    return null;
  }
}
