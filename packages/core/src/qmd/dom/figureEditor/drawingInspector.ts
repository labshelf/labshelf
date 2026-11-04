// The drawing mode's inspector for one selected object: a Properties tab (a function's expression with its typeset form and
// validity, domain and label; a segment's arrow, bend, equal-length marks and label; a curve's closing, arrows and handles;
// the sizes and turns of circles, regular polygons and stars, ellipses and arcs; an angle mark's radius, arcs and label; a
// label's TeX; a point's label, anchor, dot and node shape; the axes' ranges, labels, ticks and scale) and a Style tab
// (stroke colour, width and dash, fill colour and opacity); a node shows its style under its properties.
import { renderElement, wsButton, wsCheck, wsColour, wsField, wsInput, wsNumber, wsRow, wsSection, wsSegmented, wsSelect, wsToggle, type WsInspector } from "../../../ui/dom/index.js";
import { exprTex, isCentred, NODE_SHAPES, parseExpr, type CentredItem, type DrawingModel, type DrawingStyle, type ShapeTransform } from "../../../drawing/index.js";
import { setTransform } from "../drawingEditor/index.js";
import type { MathLoader } from "../mathView.js";
import { typeset } from "./fnTex.js";

type Item = DrawingModel["items"][number];
type Point = DrawingModel["points"][number];

export type DrawingTab = "properties" | "style";

export interface DrawingInspectorState { model: DrawingModel; key: string | null; tab: DrawingTab; loadMath: MathLoader }
export interface DrawingInspectorActions { edit(model: DrawingModel): void; tab(tab: DrawingTab): void; deselect(): void }

const ANCHORS = ["north", "south", "east", "west", "north east", "north west", "south east", "south west"].map((a) => ({ value: a, label: a[0]!.toUpperCase() + a.slice(1) }));
const DASH = [{ id: "solid", label: "Solid" }, { id: "dashed", label: "Dashed" }, { id: "dotted", label: "Dotted" }];
const ARROWS = [{ id: "none", label: "None" }, { id: "end", label: "End" }, { id: "both", label: "Both" }];
const COUNTS = [{ id: "0", label: "None" }, { id: "1", label: "1" }, { id: "2", label: "2" }, { id: "3", label: "3" }];
const SHAPE_NAMES: Readonly<Record<string, string>> = { none: "None (a point)", circle: "Circle", box: "Box", round: "Rounded box", ellipse: "Ellipse", diamond: "Diamond" };
const TITLES: Readonly<Record<Item["k"], string>> = { axes: "Cartesian axes", fn: "Function", seg: "Segment", circle: "Circle", rect: "Rectangle", poly: "Polygon", text: "Label", curve: "Curve", ngon: "Regular polygon", ellipse: "Ellipse", arc: "Arc", angle: "Angle" };

/** A copy of `obj` with `key` set, or removed when undefined or empty text. */
function withKey<T extends object>(obj: T, key: keyof T, value: unknown): T {
  const { [key]: _old, ...rest } = obj;
  return (value === undefined || value === "" ? rest : { ...rest, [key]: value }) as T;
}

/** A TeX field with its typeset preview. */
function texField(label: string, tex: string, loadMath: MathLoader, commit: (tex: string) => void): HTMLElement {
  const math = renderElement("div", { class: "ws-math" });
  const show = (value: string): void => { if (value.trim() === "") { math.replaceChildren(); return; } void typeset(value, loadMath).then((node) => math.replaceChildren(node)); };
  show(tex);
  return wsField(label, renderElement("div", { class: "fe-expr" }, wsInput(tex, commit, { mono: true, label, onInput: show }), math));
}

function fnProperties(item: Extract<Item, { k: "fn" }>, set: (item: Item) => void, s: DrawingInspectorState): HTMLElement[] {
  const math = renderElement("div", { class: "ws-math" });
  const check = renderElement("div");
  const show = (expr: string): void => {
    const parsed = parseExpr(expr);
    check.replaceChildren(wsCheck(parsed.ok ? "Valid expression" : parsed.error, parsed.ok));
    if (parsed.ok) void typeset(`f(x) = ${exprTex(parsed.ast)}`, s.loadMath).then((node) => math.replaceChildren(node));
  };
  show(item.expr);
  const main = wsSection("Expression");
  main.body.append(renderElement("div", { class: "fe-inline" }, renderElement("span", { class: "fe-expr-lead", text: "f(x) =" }), wsInput(item.expr, (expr) => set({ ...item, expr }), { mono: true, label: "Expression", onInput: show })), math, check);
  const domain = item.domain ?? [-4, 4];
  const range = wsSection("Domain");
  range.body.append(wsRow("From", wsNumber(domain[0], (lo) => set({ ...item, domain: [lo, domain[1]] }), { label: "From" }), renderElement("span", { class: "fe-hint", text: "To" }), wsNumber(domain[1], (hi) => set({ ...item, domain: [domain[0], hi] }), { label: "To" })));
  const label = wsSection("Label");
  label.body.append(texField("Label", item.label ?? "", s.loadMath, (tex) => set(withKey(item, "label", tex.trim()))), wsToggle("Show in the drawing", item.label !== undefined, (on) => set(withKey(item, "label", on ? item.label ?? "f(x)" : undefined))).element);
  return [main.element, range.element, label.element];
}

/** The properties of a curve, regular polygon, ellipse, arc or angle mark. */
function shapeProperties(item: Extract<Item, { k: "curve" | "ngon" | "ellipse" | "arc" | "angle" }>, set: (item: Item) => void, s: DrawingInspectorState): HTMLElement {
  const main = wsSection("Properties");
  switch (item.k) {
    case "curve":
      main.body.append(wsToggle("Closed", item.closed, (closed) => set(withKey({ ...item, closed }, "ctrl", undefined))).element);
      if (!item.closed) main.body.append(wsField("Arrow", wsSegmented(ARROWS, item.arrow ?? "none", (arrow) => set(withKey(item, "arrow", arrow === "none" ? undefined : arrow))).element));
      if (item.ctrl) main.body.append(wsButton({ icon: "discard", label: "Smooth again", showLabel: true }, () => set(withKey(item, "ctrl", undefined))));
      main.body.append(renderElement("p", { class: "fe-hint", text: "Drag the square handles on the canvas to shape each piece." }));
      break;
    case "ngon":
      main.body.append(wsRow("Sides", wsNumber(item.n, (n) => set({ ...item, n: Math.min(24, Math.max(3, Math.round(n))) }), { min: 3, max: 24, step: 1, label: "Sides" })),
        wsRow("Radius", wsNumber(item.r, (r) => set({ ...item, r: Math.max(0.01, r) }), { min: 0.01, step: 0.5, label: "Radius" })),
        wsToggle("Star", item.star !== undefined, (on) => set(withKey(item, "star", on ? 0.5 : undefined))).element);
      if (item.star !== undefined) main.body.append(wsRow("Inner radius", wsNumber(item.star, (star) => set({ ...item, star: Math.min(0.95, Math.max(0.05, star)) }), { min: 0.05, max: 0.95, step: 0.05, label: "Inner radius, share of the radius" })));
      break;
    case "ellipse":
      main.body.append(wsRow("Radii", wsNumber(item.rx, (rx) => set({ ...item, rx: Math.max(0.01, rx) }), { min: 0.01, step: 0.5, label: "x radius" }), wsNumber(item.ry, (ry) => set({ ...item, ry: Math.max(0.01, ry) }), { min: 0.01, step: 0.5, label: "y radius" })));
      break;
    case "arc":
      main.body.append(wsRow("Radius", wsNumber(item.r, (r) => set({ ...item, r: Math.max(0.01, r) }), { min: 0.01, step: 0.5, label: "Radius" })),
        wsRow("From", wsNumber(item.from, (from) => set({ ...item, from, to: from < item.to && item.to - from <= 360 ? item.to : from + 90 }), { step: 15, label: "Start angle" }), renderElement("span", { class: "fe-hint", text: "To" }), wsNumber(item.to, (to) => set({ ...item, to: to > item.from && to - item.from <= 360 ? to : item.from + 90 }), { step: 15, label: "End angle" })),
        wsField("Shape", wsSegmented([{ id: "open", label: "Arc" }, { id: "sector", label: "Sector" }, { id: "chord", label: "Segment" }], item.close ?? "open", (close) => set(withKey(item, "close", close === "open" ? undefined : close))).element));
      if (item.close === undefined) main.body.append(wsField("Arrow", wsSegmented(ARROWS, item.arrow ?? "none", (arrow) => set(withKey(item, "arrow", arrow === "none" ? undefined : arrow))).element));
      break;
    case "angle":
      main.body.append(wsRow("Radius", wsNumber(item.r ?? 0.8, (r) => set({ ...item, r: Math.max(0.05, r) }), { min: 0.05, step: 0.1, label: "Radius" })),
        wsField("Arcs", wsSegmented(COUNTS.slice(1), String(item.arcs ?? 1), (n) => set(withKey(item, "arcs", n === "1" ? undefined : Number(n)))).element),
        texField("Label", item.label ?? "", s.loadMath, (tex) => set(withKey(item, "label", tex.trim()))),
        renderElement("p", { class: "fe-hint", text: "A right angle is marked with a square." }));
      break;
  }
  return main.element;
}

/** Turn, slant and stretch of a shape drawn around a centre, as the canvas's transform box sets them. */
function transformSection(item: CentredItem, set: (item: Item) => void): HTMLElement {
  const tf = item.tf ?? {};
  const put = (key: keyof ShapeTransform, value: number): void => set(setTransform(item, { ...tf, [key]: value }));
  const main = wsSection("Transform");
  main.body.append(wsRow("Rotation", wsNumber(tf.rot ?? 0, (v) => put("rot", v), { step: 15, label: "Rotation in degrees" })),
    wsRow("Skew", wsNumber(tf.skew ?? 0, (v) => put("skew", Math.max(-85, Math.min(85, v))), { min: -85, max: 85, step: 5, label: "Skew in degrees" })),
    wsRow("Stretch", wsNumber(tf.sx ?? 1, (v) => put("sx", v || 1), { step: 0.1, label: "Stretch along x" }), wsNumber(tf.sy ?? 1, (v) => put("sy", v || 1), { step: 0.1, label: "Stretch along y" })),
    renderElement("p", { class: "fe-hint", text: "Or drag the box's handles: sides and corners stretch, the disc turns, the slanted square skews." }));
  return main.element;
}

function itemProperties(item: Item, set: (item: Item) => void, s: DrawingInspectorState): HTMLElement[] {
  const main = wsSection("Properties");
  switch (item.k) {
    case "fn": return fnProperties(item, set, s);
    case "seg":
      main.body.append(wsField("Arrow", wsSegmented(ARROWS, item.arrow, (arrow) => set({ ...item, arrow: arrow as typeof item.arrow }), "fe-wide").element),
        wsRow("Bend", wsNumber(item.bend ?? 0, (bend) => set(withKey(item, "bend", bend === 0 ? undefined : bend)), { min: -90, max: 90, step: 5, label: "Bend" })),
        texField("Label", item.label ?? "", s.loadMath, (tex) => set(withKey(item, "label", tex.trim()))),
        wsField("Label side", wsSegmented([{ id: "left", label: "Left" }, { id: "right", label: "Right" }], item.side ?? "left", (side) => set({ ...item, side: side as "left" | "right" })).element),
        wsField("Equal-length marks", wsSegmented(COUNTS, String(item.marks ?? 0), (m) => set(withKey(item, "marks", m === "0" ? undefined : Number(m)))).element));
      break;
    case "curve": case "ngon": case "ellipse": case "arc": case "angle": return [shapeProperties(item, set, s)];
    case "circle": main.body.append(wsRow("Radius", wsNumber(item.r, (r) => set({ ...item, r: Math.max(0.01, r) }), { min: 0.01, step: 0.5, label: "Radius" }))); break;
    case "poly": main.body.append(wsToggle("Closed", item.closed, (closed) => set({ ...item, closed })).element); break;
    case "text": main.body.append(texField("TeX", item.tex, s.loadMath, (tex) => set({ ...item, tex })), wsRow("Position", wsNumber(item.x, (x) => set({ ...item, x }), { label: "x" }), wsNumber(item.y, (y) => set({ ...item, y }), { label: "y" }))); break;
    case "axes":
      main.body.append(wsRow("x from", wsNumber(item.x[0], (lo) => set({ ...item, x: [lo, item.x[1]] }), { label: "x from" }), wsNumber(item.x[1], (hi) => set({ ...item, x: [item.x[0], hi] }), { label: "x to" })),
        wsRow("y from", wsNumber(item.y[0], (lo) => set({ ...item, y: [lo, item.y[1]] }), { label: "y from" }), wsNumber(item.y[1], (hi) => set({ ...item, y: [item.y[0], hi] }), { label: "y to" })),
        wsRow("Scale", wsNumber(item.sx, (sx) => set({ ...item, sx: Math.max(0.01, sx) }), { step: 0.5, label: "x scale" }), wsNumber(item.sy, (sy) => set({ ...item, sy: Math.max(0.01, sy) }), { step: 0.5, label: "y scale" })),
        texField("x label", item.xlabel ?? "", s.loadMath, (tex) => set(withKey(item, "xlabel", tex.trim()))), texField("y label", item.ylabel ?? "", s.loadMath, (tex) => set(withKey(item, "ylabel", tex.trim()))),
        wsToggle("Ticks", item.ticks, (ticks) => set({ ...item, ticks })).element);
      break;
    case "rect": main.body.append(renderElement("p", { class: "fe-hint", text: "Drag its corners on the canvas to resize it." })); break;
  }
  return [main.element];
}

/** Whether the item draws a closed outline that a fill can show in. */
function fillable(item: Item): boolean {
  switch (item.k) {
    case "circle": case "rect": case "ngon": case "ellipse": case "angle": return true;
    case "poly": case "curve": return item.closed;
    case "arc": return item.close !== undefined;
    default: return false;
  }
}

/** The stroke's colour, width and dash, and when the outline is closed the fill's colour and opacity. */
function styleSection(style: DrawingStyle, setStyle: (style: DrawingStyle) => void, canFill: boolean): HTMLElement {
  const main = wsSection("Stroke");
  main.body.append(wsRow("Colour", wsColour(style.color ?? "#1f2328", (color) => setStyle({ ...style, color }))),
    wsRow("Width", wsSegmented([{ id: "thin", label: "Normal" }, { id: "thick", label: "Thick" }], style.thick ? "thick" : "thin", (w) => setStyle(withKey(style, "thick", w === "thick" ? true : undefined))).element),
    wsRow("Style", wsSegmented(DASH, style.dash ?? "solid", (d) => setStyle(withKey(style, "dash", d === "solid" ? undefined : d))).element));
  if (!canFill) return main.element;
  main.body.append(wsToggle("Fill", style.fill !== undefined, (on) => setStyle(on ? { ...style, fill: style.color ?? "#1f2328", opacity: 0.25 } : withKey(withKey(style, "fill", undefined), "opacity", undefined))).element);
  if (style.fill !== undefined) {
    main.body.append(wsRow("Fill colour", wsColour(style.fill, (fill) => setStyle({ ...style, fill }))),
      wsRow("Opacity", wsNumber(style.opacity ?? 1, (o) => setStyle(withKey(style, "opacity", o >= 1 ? undefined : Math.max(0.05, Math.round(o * 100) / 100))), { min: 0.05, max: 1, step: 0.05, label: "Fill opacity" })));
  }
  return main.element;
}

function styleTab(item: Item, set: (item: Item) => void): HTMLElement[] {
  if (item.k === "text" || item.k === "axes") return [renderElement("p", { class: "ws-empty", text: "This object has no stroke of its own." })];
  const setStyle = (next: DrawingStyle): void => set(Object.keys(next).length > 0 ? { ...item, style: next } : withKey(item, "style", undefined));
  return [styleSection(item.style ?? {}, setStyle, fillable(item))];
}

function pointProperties(point: Point, s: DrawingInspectorState, a: DrawingInspectorActions): HTMLElement[] {
  const set = (next: Point): void => a.edit({ ...s.model, points: s.model.points.map((p) => (p.id === point.id ? next : p)) });
  const main = wsSection("Point");
  main.body.append(texField("Label", point.label ?? "", s.loadMath, (tex) => set(withKey(point, "label", tex.trim()))));
  if (point.shape === undefined) main.body.append(wsField("Label position", wsSelect(ANCHORS, point.at ?? "north east", (at) => set({ ...point, at }), "Label position")));
  main.body.append(wsField("Node", wsSelect(["none", ...NODE_SHAPES].map((v) => ({ value: v, label: SHAPE_NAMES[v] ?? v })), point.shape ?? "none", (shape) => set(withKey(withKey(point, "style", shape === "none" ? undefined : point.style), "shape", shape === "none" ? undefined : shape)), "Node shape")));
  if (point.shape === undefined) main.body.append(wsToggle("Draw a dot", point.dot, (dot) => set({ ...point, dot })).element);
  main.body.append(wsRow("Position", wsNumber(point.x, (x) => set({ ...point, x }), { label: "x" }), wsNumber(point.y, (y) => set({ ...point, y }), { label: "y" })));
  if (point.shape === undefined) return [main.element];
  return [main.element, styleSection(point.style ?? {}, (style) => set(withKey(point, "style", Object.keys(style).length > 0 ? style : undefined)), true)];
}

/** Fills the inspector for the selected object, or with the drawing's summary. */
export function renderDrawingInspector(inspector: WsInspector, s: DrawingInspectorState, a: DrawingInspectorActions): void {
  const index = s.key !== null && /^i\d+$/.test(s.key) ? Number(s.key.slice(1)) : null;
  const item = index === null ? undefined : s.model.items[index];
  const point = s.key === null ? undefined : s.model.points.find((p) => p.id === s.key);
  if (item !== undefined && index !== null) {
    const set = (next: Item): void => a.edit({ ...s.model, items: s.model.items.map((it, i) => (i === index ? next : it)) });
    inspector.show({ title: TITLES[item.k], icon: item.k === "fn" ? "sine" : "segment", tabs: [{ id: "properties", label: "Properties" }, { id: "style", label: "Style" }], tab: s.tab, onTab: (id) => a.tab(id as DrawingTab), onClose: a.deselect });
    const properties = (): HTMLElement[] => [...itemProperties(item, set, s), ...(isCentred(item) ? [transformSection(item, set)] : [])];
    inspector.body.replaceChildren(...(s.tab === "properties" ? properties() : styleTab(item, set)));
    return;
  }
  if (point !== undefined) {
    inspector.show({ title: `${point.shape ? "Node" : "Point"} ${point.label?.replace(/[\\{}$]/g, "") || point.id}`, icon: "circle-small-filled", onClose: a.deselect });
    inspector.body.replaceChildren(...pointProperties(point, s, a));
    return;
  }
  inspector.show({ title: "Drawing", icon: "segment" });
  inspector.body.replaceChildren(renderElement("p", { class: "ws-empty", text: "Select another object to see its properties." }));
}
