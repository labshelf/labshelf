// SVG printer (decision D5): writes a drawing model as one line of SVG from the same layout as tikz.ts, so the label anchors
// match. Labels come from an injected TeX renderer; strokes use currentColor; no style= anywhere (webview CSP), and no
// namespace declarations (the markup lives in an HTML document), so every attribute is a presentation attribute.
import type { DrawingModel, Vec } from "./model.js";
import { PX_PER_UNIT, type DrawingLayout } from "./layout.js";

type DrawingItem = DrawingModel["items"][number];
type DrawingStyle = NonNullable<Extract<DrawingItem, { k: "seg" }>["style"]>;

const PX = PX_PER_UNIT;
/** Clearance, in pixels, between an anchor and its label box. */
const GAP = 3;
/** Half the length of a tick mark (0.15 grid units, as in tikz.ts). */
const TICK = 0.15 * PX;
const DOT_RADIUS = 2;
const LINE_WIDTH = 0.8;
const THICK_WIDTH = 1.6;
const MARGIN = 4;
const ARROW_ID = "ls-arrow";
/** A stealth arrowhead with its tip at the origin, pointing along +x. */
const ARROW_PATH = "M0 0L-8 -3.3L-6 0L-8 3.3Z";
/** The size a label gets when its markup does not say. */
const DEFAULT_LABEL: [number, number] = [10, 14];
const EX = 8;

type Box = [left: number, top: number];

function n(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? "0" : String(rounded);
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Model y is up, SVG y is down. */
function screen(v: Vec): Vec {
  return { x: v.x * PX, y: -v.y * PX };
}

/** A TikZ colour as an SVG paint: `red!40` mixes with white. */
function paint(color: string): string {
  const mix = /^([A-Za-z]+)!(\d{1,3})$/.exec(color);
  return esc(mix ? `color-mix(in srgb, ${mix[1]} ${mix[2]}%, white)` : color);
}

function strokeAttrs(style: DrawingStyle | undefined, withFill: boolean): string {
  let out = "";
  if (style?.color) { out += ` stroke="${paint(style.color)}"`; }
  if (withFill && style?.fill) { out += ` fill="${paint(style.fill)}"`; }
  if (style?.thick) { out += ` stroke-width="${THICK_WIDTH}"`; }
  if (style?.dash === "dashed") { out += ' stroke-dasharray="4 4"'; }
  if (style?.dash === "dotted") { out += ' stroke-dasharray="1.3 2.7"'; }
  return out;
}

class Bounds {
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  point(x: number, y: number): void {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }

  box(left: number, top: number, width: number, height: number): void {
    this.point(left, top);
    this.point(left + width, top + height);
  }

  viewBox(): { x: number; y: number; width: number; height: number } {
    if (!Number.isFinite(this.minX)) { return { x: 0, y: 0, width: 1, height: 1 }; }
    return { x: this.minX - MARGIN, y: this.minY - MARGIN, width: this.maxX - this.minX + 2 * MARGIN, height: this.maxY - this.minY + 2 * MARGIN };
  }
}

const STYLE_ATTRIBUTE = /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const NAMESPACE_ATTRIBUTE = /\sxmlns(?::[\w-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/g;

/** Label markup as one line without style attributes or namespace declarations (xlink:href becomes href). */
function cleanLabel(markup: string): string {
  return markup
    .replace(STYLE_ATTRIBUTE, "")
    .replace(NAMESPACE_ATTRIBUTE, "")
    .replace(/\sxlink:href\s*=/g, " href=")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

function length(value: string | undefined): number | undefined {
  const m = /^\s*(\d*\.?\d+)\s*(px|ex|em)?\s*$/.exec(value ?? "");
  if (!m) { return undefined; }
  const v = Number(m[1]);
  return m[2] === "ex" ? v * EX : m[2] === "em" ? v * EX * 2 : v;
}

function labelSize(markup: string): [number, number] {
  const tag = /^<svg\b[^>]*>/i.exec(markup)?.[0] ?? "";
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1];
  return [length(attr("width")) ?? DEFAULT_LABEL[0], length(attr("height")) ?? DEFAULT_LABEL[1]];
}

interface Context {
  bounds: Bounds;
  renderLabel: (tex: string) => string;
  arrow: { used: boolean };
}

/** A label box placed by `place(width, height)` -> top-left corner, in a positioned g. */
function label(ctx: Context, tex: string, place: (width: number, height: number) => Box): string {
  const markup = cleanLabel(ctx.renderLabel(tex));
  const [w, h] = labelSize(markup);
  const [left, top] = place(w, h);
  ctx.bounds.box(left, top, w, h);
  return `<g transform="translate(${n(left)} ${n(top)})" fill="currentColor" stroke="none">${markup}</g>`;
}

/** The box at one of the eight anchors of the point p (screen coordinates). */
function atAnchor(p: Vec, anchor: string): (w: number, h: number) => Box {
  const diag = GAP * 0.7;
  return (w, h) => {
    switch (anchor) {
      case "above": return [p.x - w / 2, p.y - GAP - h];
      case "above right": return [p.x + diag, p.y - diag - h];
      case "right": return [p.x + GAP, p.y - h / 2];
      case "below right": return [p.x + diag, p.y + diag];
      case "below": return [p.x - w / 2, p.y + GAP];
      case "below left": return [p.x - diag - w, p.y + diag];
      case "left": return [p.x - GAP - w, p.y - h / 2];
      case "above left": return [p.x - diag - w, p.y - diag - h];
      default: return [p.x - w / 2, p.y - h / 2];
    }
  };
}

function arrowHead(ctx: Context, tip: Vec, from: Vec, style: DrawingStyle | undefined): string {
  ctx.arrow.used = true;
  ctx.bounds.point(tip.x, tip.y);
  const angle = (Math.atan2(tip.y - from.y, tip.x - from.x) * 180) / Math.PI;
  const color = style?.color ? paint(style.color) : "currentColor";
  return `<use href="#${ARROW_ID}" fill="${color}" stroke="none" transform="translate(${n(tip.x)} ${n(tip.y)}) rotate(${n(angle)})"/>`;
}

function segment(ctx: Context, item: Extract<DrawingItem, { k: "seg" }>, index: number, layout: DrawingLayout): string {
  const s = layout.segments.get(index);
  if (!s) { return ""; }
  const a = screen(s.from);
  const b = screen(s.to);
  ctx.bounds.point(a.x, a.y);
  ctx.bounds.point(b.x, b.y);
  const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
  // A bend of t degrees leaves each end t degrees off the chord: the quadratic's control point sits (len / 2) * tan(t) off the middle.
  let control: Vec | undefined;
  let mid: Vec = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (s.bend !== 0 && len > 1e-9) {
    const offset = (len / 2) * Math.tan((s.bend * Math.PI) / 180);
    const left = screen({ x: (-(s.to.y - s.from.y) / len) * offset, y: ((s.to.x - s.from.x) / len) * offset });
    control = { x: mid.x + left.x, y: mid.y + left.y };
    ctx.bounds.point(control.x, control.y);
    mid = { x: (a.x + 2 * control.x + b.x) / 4, y: (a.y + 2 * control.y + b.y) / 4 };
  }
  const attrs = strokeAttrs(item.style, false);
  let out = control
    ? `<path d="M${n(a.x)} ${n(a.y)}Q${n(control.x)} ${n(control.y)} ${n(b.x)} ${n(b.y)}"${attrs}/>`
    : `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"${attrs}/>`;
  if (item.arrow === "end" || item.arrow === "both") { out += arrowHead(ctx, b, control ?? a, item.style); }
  if (item.arrow === "both") { out += arrowHead(ctx, a, control ?? b, item.style); }
  if (item.label !== undefined && item.label !== "") {
    // The label sits on the layout's side of the segment: left or right of travel, away from the centroid.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const norm = Math.hypot(dx, dy) || 1;
    // Left of travel in screen coordinates (y down) is (dy, -dx); right is the opposite.
    const sign = s.side === "left" ? 1 : -1;
    const nx = (sign * dy) / norm;
    const ny = (-sign * dx) / norm;
    out += label(ctx, item.label, (w, h) => {
      const reach = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + GAP;
      return [mid.x + nx * reach - w / 2, mid.y + ny * reach - h / 2];
    });
  }
  return out;
}

function axes(ctx: Context, item: Extract<DrawingItem, { k: "axes" }>, layout: DrawingLayout): string {
  const a = layout.axes.get(item.id);
  if (!a) { return ""; }
  // The axis lines cross at the origin, or at the nearest edge of the box when the origin lies outside it.
  const axisY = Math.min(a.to.y, Math.max(a.from.y, a.origin.y));
  const axisX = Math.min(a.to.x, Math.max(a.from.x, a.origin.x));
  const x0 = screen({ x: a.from.x, y: axisY });
  const x1 = screen({ x: a.to.x, y: axisY });
  const y0 = screen({ x: axisX, y: a.from.y });
  const y1 = screen({ x: axisX, y: a.to.y });
  for (const p of [x0, x1, y0, y1]) { ctx.bounds.point(p.x, p.y); }
  let out = `<line x1="${n(x0.x)}" y1="${n(x0.y)}" x2="${n(x1.x)}" y2="${n(x1.y)}"/>${arrowHead(ctx, x1, x0, undefined)}`;
  out += `<line x1="${n(y0.x)}" y1="${n(y0.y)}" x2="${n(y1.x)}" y2="${n(y1.y)}"/>${arrowHead(ctx, y1, y0, undefined)}`;
  for (const t of a.xTicks) {
    const p = screen(t.at);
    out += `<line x1="${n(p.x)}" y1="${n(p.y - TICK)}" x2="${n(p.x)}" y2="${n(p.y + TICK)}"/>`;
    out += label(ctx, t.label, (w) => [p.x - w / 2, p.y + TICK + GAP]);
  }
  for (const t of a.yTicks) {
    const p = screen(t.at);
    out += `<line x1="${n(p.x - TICK)}" y1="${n(p.y)}" x2="${n(p.x + TICK)}" y2="${n(p.y)}"/>`;
    out += label(ctx, t.label, (w, h) => [p.x - TICK - GAP - w, p.y - h / 2]);
  }
  if (item.xlabel !== undefined && item.xlabel !== "") {
    out += label(ctx, item.xlabel, (_w, h) => [x1.x + GAP,x1.y - h / 2]);
  }
  if (item.ylabel !== undefined && item.ylabel !== "") {
    out += label(ctx, item.ylabel, (w, h) => [y1.x - w / 2, y1.y - GAP - h]);
  }
  return out;
}

function pointOf(id: string, layout: DrawingLayout): Vec {
  const p = layout.points.get(id);
  return screen(p ?? { x: 0, y: 0 });
}

function itemSvg(ctx: Context, item: DrawingItem, index: number, layout: DrawingLayout): string {
  switch (item.k) {
    case "seg":
      return segment(ctx, item, index, layout);
    case "circle": {
      const c = pointOf(item.c, layout);
      const r = item.r * PX;
      ctx.bounds.box(c.x - r, c.y - r, 2 * r, 2 * r);
      return `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}"${strokeAttrs(item.style, true)}/>`;
    }
    case "rect": {
      const a = pointOf(item.a, layout);
      const b = pointOf(item.b, layout);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.bounds.box(x, y, w, h);
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${strokeAttrs(item.style, true)}/>`;
    }
    case "poly": {
      const pts = item.pts.map((id) => pointOf(id, layout));
      for (const p of pts) { ctx.bounds.point(p.x, p.y); }
      const list = pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
      return `<${item.closed ? "polygon" : "polyline"} points="${list}"${strokeAttrs(item.style, true)}/>`;
    }
    case "text": {
      if (item.tex === "") { return ""; }
      const p = screen(item);
      return label(ctx, item.tex, atAnchor(p, "centre"));
    }
    case "axes":
      return axes(ctx, item, layout);
    case "fn": {
      const runs = (layout.curves.get(index) ?? []).filter((run) => run.length > 1);
      const attrs = strokeAttrs(item.style, false);
      return runs.map((run, i) => {
        const pts = run.map(screen);
        for (const p of pts) { ctx.bounds.point(p.x, p.y); }
        const list = pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
        let out = `<polyline points="${list}"${attrs}/>`;
        const end = pts[pts.length - 1];
        if (item.label !== undefined && item.label !== "" && i === runs.length - 1 && end) {
          out += label(ctx, item.label, (_w, h) => [end.x + GAP, end.y - h / 2]);
        }
        return out;
      }).join("");
    }
  }
}

export function formatDrawingSvg(model: import("./model.js").DrawingModel, layout: import("./layout.js").DrawingLayout, renderLabel: (tex: string) => string): string {
  const ctx: Context = { bounds: new Bounds(), renderLabel, arrow: { used: false } };
  const parts: string[] = [];
  model.items.forEach((item, index) => { parts.push(itemSvg(ctx, item, index, layout)); });
  for (const p of model.points) {
    if (!p.dot) { continue; }
    const c = pointOf(p.id, layout);
    ctx.bounds.box(c.x - DOT_RADIUS, c.y - DOT_RADIUS, 2 * DOT_RADIUS, 2 * DOT_RADIUS);
    parts.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${DOT_RADIUS}" fill="currentColor" stroke="none"/>`);
  }
  for (const p of model.points) {
    if (p.label === undefined || p.label === "") { continue; }
    // A dot-less labelled point is shown by its label alone, centred on it (segments stop short of the box);
    // a dotted one gets its label beside the dot at the layout's anchor.
    const c = pointOf(p.id, layout);
    const anchor = p.dot ? layout.points.get(p.id)?.anchor ?? "above right" : "centre";
    parts.push(label(ctx, p.label, atAnchor(c, anchor)));
  }
  const defs = ctx.arrow.used ? `<defs><path id="${ARROW_ID}" d="${ARROW_PATH}"/></defs>` : "";
  const vb = ctx.bounds.viewBox();
  const group = `<g stroke="currentColor" fill="none" stroke-width="${LINE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</g>`;
  return `<svg width="${n(vb.width)}" height="${n(vb.height)}" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.width)} ${n(vb.height)}">${defs}${group}</svg>`;
}
