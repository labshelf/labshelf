// The drawing mode's inspector for one selected object: a Properties tab (a function's expression with its typeset form and
// validity, domain and label; a segment's arrow, bend and label; a circle's radius; a label's TeX; a point's label, anchor and
// dot; the axes' ranges, labels, ticks and scale) and a Style tab (stroke colour, width and dash, fill).
import { renderElement, wsCheck, wsColour, wsField, wsInput, wsNumber, wsRow, wsSection, wsSegmented, wsSelect, wsToggle, type WsInspector } from "../../../ui/dom/index.js";
import { exprTex, parseExpr, type DrawingModel, type DrawingStyle } from "../../../drawing/index.js";
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
const TITLES: Readonly<Record<Item["k"], string>> = { axes: "Cartesian axes", fn: "Function", seg: "Segment", circle: "Circle", rect: "Rectangle", poly: "Polygon", text: "Label" };

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

function itemProperties(item: Item, set: (item: Item) => void, s: DrawingInspectorState): HTMLElement[] {
  const main = wsSection("Properties");
  switch (item.k) {
    case "fn": return fnProperties(item, set, s);
    case "seg":
      main.body.append(wsField("Arrow", wsSegmented(ARROWS, item.arrow, (arrow) => set({ ...item, arrow: arrow as typeof item.arrow }), "fe-wide").element),
        wsRow("Bend", wsNumber(item.bend ?? 0, (bend) => set(withKey(item, "bend", bend === 0 ? undefined : bend)), { min: -90, max: 90, step: 5, label: "Bend" })),
        texField("Label", item.label ?? "", s.loadMath, (tex) => set(withKey(item, "label", tex.trim()))),
        wsField("Label side", wsSegmented([{ id: "left", label: "Left" }, { id: "right", label: "Right" }], item.side ?? "left", (side) => set({ ...item, side: side as "left" | "right" })).element));
      break;
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

function styleTab(item: Item, set: (item: Item) => void): HTMLElement[] {
  if (item.k === "text" || item.k === "axes") return [renderElement("p", { class: "ws-empty", text: "This object has no stroke of its own." })];
  const style: DrawingStyle = item.style ?? {};
  const setStyle = (next: DrawingStyle): void => set(Object.keys(next).length > 0 ? { ...item, style: next } : withKey(item, "style", undefined));
  const main = wsSection("Stroke");
  main.body.append(wsRow("Colour", wsColour(style.color ?? "#1f2328", (color) => setStyle({ ...style, color }))),
    wsRow("Width", wsSegmented([{ id: "thin", label: "Normal" }, { id: "thick", label: "Thick" }], style.thick ? "thick" : "thin", (w) => setStyle(withKey(style, "thick", w === "thick" ? true : undefined))).element),
    wsRow("Style", wsSegmented(DASH, style.dash ?? "solid", (d) => setStyle(withKey(style, "dash", d === "solid" ? undefined : d))).element));
  if (item.k === "circle" || item.k === "rect" || item.k === "poly") main.body.append(wsToggle("Fill", style.fill !== undefined, (on) => setStyle(withKey(style, "fill", on ? style.color ?? "#1f2328" : undefined))).element);
  return [main.element];
}

function pointProperties(point: Point, s: DrawingInspectorState, a: DrawingInspectorActions): HTMLElement[] {
  const set = (next: Point): void => a.edit({ ...s.model, points: s.model.points.map((p) => (p.id === point.id ? next : p)) });
  const main = wsSection("Point");
  main.body.append(texField("Label", point.label ?? "", s.loadMath, (tex) => set(withKey(point, "label", tex.trim()))),
    wsField("Label position", wsSelect(ANCHORS, point.at ?? "north east", (at) => set({ ...point, at }), "Label position")),
    wsToggle("Draw a dot", point.dot, (dot) => set({ ...point, dot })).element,
    wsRow("Position", wsNumber(point.x, (x) => set({ ...point, x }), { label: "x" }), wsNumber(point.y, (y) => set({ ...point, y }), { label: "y" })));
  return [main.element];
}

/** Fills the inspector for the selected object, or with the drawing's summary. */
export function renderDrawingInspector(inspector: WsInspector, s: DrawingInspectorState, a: DrawingInspectorActions): void {
  const index = s.key !== null && /^i\d+$/.test(s.key) ? Number(s.key.slice(1)) : null;
  const item = index === null ? undefined : s.model.items[index];
  const point = s.key === null ? undefined : s.model.points.find((p) => p.id === s.key);
  if (item !== undefined && index !== null) {
    const set = (next: Item): void => a.edit({ ...s.model, items: s.model.items.map((it, i) => (i === index ? next : it)) });
    inspector.show({ title: TITLES[item.k], icon: item.k === "fn" ? "sine" : "segment", tabs: [{ id: "properties", label: "Properties" }, { id: "style", label: "Style" }], tab: s.tab, onTab: (id) => a.tab(id as DrawingTab), onClose: a.deselect });
    inspector.body.replaceChildren(...(s.tab === "properties" ? itemProperties(item, set, s) : styleTab(item, set)));
    return;
  }
  if (point !== undefined) {
    inspector.show({ title: `Point ${point.label?.replace(/[\\{}$]/g, "") || point.id}`, icon: "circle-small-filled", onClose: a.deselect });
    inspector.body.replaceChildren(...pointProperties(point, s, a));
    return;
  }
  inspector.show({ title: "Drawing", icon: "segment" });
  inspector.body.replaceChildren(renderElement("p", { class: "ws-empty", text: "Select another object to see its properties." }));
}
