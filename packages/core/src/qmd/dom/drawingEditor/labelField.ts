// The drawing editor's in-place fields (decisions D7, D9, D10): a TeX field over the point, segment or text being labelled, the expression field of a function (the curve redraws on every input) and the range and axis-label fields of axes. Enter confirms, Tab confirms and moves to the next point, Esc puts back what the field opened with. The field sits in a foreignObject placed by SVG attributes, so nothing needs a style attribute.
import { renderElement } from "../../../ui/dom/index.js";
import { parseExpr, PX_PER_UNIT, type DrawingModel, type Vec } from "../../../drawing/index.js";
import { applyEvent, commitLabel } from "./gestures.js";
import type { EditorSession } from "./drawingCanvas.js";
import { itemIndexOf, reflow, type Axes } from "./state.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FIELD_W = 180;
const FIELD_H = 30;
const AXES_W = 300;
const AXES_H = 64;
/** Screen px between the labelled spot and the field. */
const OFFSET = 10;

export interface LabelField {
  /** Mounts, moves or removes the field to match `session.state.editingLabel`; called on every render. */
  sync(): void;
  destroy(): void;
}

type Field = HTMLInputElement;
type AxesFields = { xFrom: Field; xTo: Field; yFrom: Field; yTo: Field; xlabel: Field; ylabel: Field };

interface Mounted {
  key: string;
  /** The model as the field opened: Esc puts it back. */
  openedWith: DrawingModel;
  box: SVGForeignObjectElement;
  first: Field;
}

const key = (name: string, shift = false) => ({ type: "key" as const, key: name, shift, mod: false });

function screen(v: Vec): Vec {
  return { x: v.x * PX_PER_UNIT, y: -v.y * PX_PER_UNIT };
}

function axesBox(model: DrawingModel, axes: Axes): { from: Vec; to: Vec } | undefined {
  const origin = model.points.find((p) => p.id === axes.o);
  if (!origin) { return undefined; }
  return {
    from: { x: origin.x + axes.x[0] * axes.sx, y: origin.y + axes.y[0] * axes.sy },
    to: { x: origin.x + axes.x[1] * axes.sx, y: origin.y + axes.y[1] * axes.sy },
  };
}

/** Where the field for `editing` goes (top-left, canvas px) and what it edits; undefined when the key names nothing. */
function target(model: DrawingModel, editing: string): { at: Vec; kind: "text" | "expr" | "axes"; value: string; axes?: Axes } | undefined {
  const index = itemIndexOf(editing);
  const byId = (id: string) => model.points.find((p) => p.id === id);
  const below = (v: Vec, width: number): Vec => { const s = screen(v); return { x: s.x - width / 2, y: s.y + OFFSET }; };
  if (index === null) {
    const point = byId(editing);
    return point ? { at: below(point, FIELD_W), kind: "text", value: point.label ?? "" } : undefined;
  }
  const item = model.items[index];
  switch (item?.k) {
    case "seg": {
      const a = byId(item.a);
      const b = byId(item.b);
      return a && b ? { at: below({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, FIELD_W), kind: "text", value: item.label ?? "" } : undefined;
    }
    case "angle": {
      const o = byId(item.o);
      return o ? { at: below(o, FIELD_W), kind: "text", value: item.label ?? "" } : undefined;
    }
    case "text": return { at: below(item, FIELD_W), kind: "text", value: item.tex };
    case "fn": {
      const axes = model.items.find((other): other is Axes => other.k === "axes" && other.id === item.axes);
      const box = axes && axesBox(model, axes);
      const corner = box ? screen({ x: Math.min(box.from.x, box.to.x), y: Math.max(box.from.y, box.to.y) }) : { x: 0, y: 0 };
      return { at: { x: corner.x, y: corner.y - FIELD_H - OFFSET }, kind: "expr", value: item.expr };
    }
    case "axes": {
      const box = axesBox(model, item);
      const corner = box ? screen({ x: Math.min(box.from.x, box.to.x), y: Math.min(box.from.y, box.to.y) }) : { x: 0, y: 0 };
      return { at: { x: corner.x, y: corner.y + OFFSET }, kind: "axes", value: "", axes: item };
    }
    default: return undefined;
  }
}

function input(value: string, label: string, cls: string): Field {
  const el = renderElement("input", { type: "text", class: cls, "aria-label": label, spellcheck: "false", autocomplete: "off" }) as Field;
  el.value = value;
  return el;
}

function markInvalid(field: Field, invalid: boolean): void {
  field.classList.toggle("is-error", invalid);
  if (invalid) { field.setAttribute("aria-invalid", "true"); } else { field.removeAttribute("aria-invalid"); }
}

/** A number typed in a range field, or null when it is not one. */
function numberOf(field: Field): number | null {
  const text = field.value.trim();
  const value = text === "" ? NaN : Number(text);
  return Number.isFinite(value) ? value : null;
}

/** The axes item as the fields say, or null when a range is not a number or not increasing (those fields are marked). */
function readAxes(axes: Axes, fields: AxesFields): Axes | null {
  const [x0, x1, y0, y1] = [numberOf(fields.xFrom), numberOf(fields.xTo), numberOf(fields.yFrom), numberOf(fields.yTo)];
  const xOk = x0 !== null && x1 !== null && x0 < x1;
  const yOk = y0 !== null && y1 !== null && y0 < y1;
  markInvalid(fields.xFrom, !xOk);
  markInvalid(fields.xTo, !xOk);
  markInvalid(fields.yFrom, !yOk);
  markInvalid(fields.yTo, !yOk);
  if (!xOk || !yOk) { return null; }
  const { xlabel: _x, ylabel: _y, ...rest } = axes;
  const xlabel = fields.xlabel.value;
  const ylabel = fields.ylabel.value;
  return { ...rest, x: [x0, x1], y: [y0, y1], ...(xlabel !== "" ? { xlabel } : {}), ...(ylabel !== "" ? { ylabel } : {}) };
}

function withAxes(model: DrawingModel, index: number, axes: Axes): DrawingModel {
  return reflow({ ...model, items: model.items.map((item, at) => (at === index ? axes : item)) });
}

/** The session and the field mounted in it, shared by the TeX, expression and axes fields. */
interface FieldHost { readonly session: EditorSession; mounted: Mounted | null }

/** Removes the field; when it held the focus, the canvas takes it back so tool keys and ⌘Z keep working in the editor (a removed focused field leaves the focus on the body). */
function unmount(host: FieldHost): void {
  const box = host.mounted?.box;
  host.mounted = null;
  if (!box) { return; }
  const focused = box.contains(document.activeElement);
  box.remove();
  if (focused && host.session.canvas.isConnected) { host.session.canvas.focus({ preventScroll: true }); }
}

/** Claims Enter (and Tab where given) and Escape for the field; Escape puts back the model the field opened with and closes it, so only a confirming key returns true. */
function takeKey(host: FieldHost, event: KeyboardEvent, confirm: readonly string[]): boolean {
  if (event.key !== "Escape" && !confirm.includes(event.key)) { return false; }
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    const { session, mounted } = host;
    if (mounted) { session.update(applyEvent({ ...session.state, model: mounted.openedWith }, key("Escape"), session.scale)); }
    return false;
  }
  return true;
}

/** The TeX field of a label, or the expression field of a function (marked while it does not parse). */
function textField(host: FieldHost, editing: string, value: string, expr: boolean): Field {
  const { session } = host;
  const field = input(value, expr ? "Function expression, y =" : "Label (TeX)", expr ? "qmd-drawing-field is-expr" : "qmd-drawing-field");
  const check = () => { if (expr) { markInvalid(field, !parseExpr(field.value).ok); } };
  check();
  field.addEventListener("input", () => {
    check();
    if (session.state.editingLabel === editing) { session.preview(commitLabel(session.state, field.value)); }
  });
  field.addEventListener("keydown", (event) => {
    if (!takeKey(host, event, ["Enter", "Tab"])) { return; }
    const written = commitLabel(session.state, field.value);
    // Tab opens a fresh field even when the next point is this one, so its Esc keeps what was just confirmed.
    if (event.key === "Tab") { unmount(host); }
    session.update(applyEvent(written, key(event.key, event.shiftKey), session.scale));
  });
  return field;
}

function createAxesInputs(axes: Axes): AxesFields {
  return {
    xFrom: input(String(axes.x[0]), "x from", "qmd-drawing-field is-range"),
    xTo: input(String(axes.x[1]), "x to", "qmd-drawing-field is-range"),
    yFrom: input(String(axes.y[0]), "y from", "qmd-drawing-field is-range"),
    yTo: input(String(axes.y[1]), "y to", "qmd-drawing-field is-range"),
    xlabel: input(axes.xlabel ?? "", "x axis label (TeX)", "qmd-drawing-field"),
    ylabel: input(axes.ylabel ?? "", "y axis label (TeX)", "qmd-drawing-field"),
  };
}

/** The range and axis-label fields of axes: every valid input previews, Enter confirms. */
function axesFields(host: FieldHost, editing: string, axes: Axes): { el: HTMLElement; first: Field } {
  const { session } = host;
  const index = itemIndexOf(editing);
  const fields = createAxesInputs(axes);
  const apply = (): DrawingModel | null => {
    const next = index === null ? null : readAxes(axes, fields);
    return next && index !== null ? withAxes(session.state.model, index, next) : null;
  };
  const el = renderElement("div", { class: "qmd-drawing-axes-fields" },
    renderElement("span", { class: "qmd-drawing-field-row" }, renderElement("span", { class: "qmd-drawing-field-label", text: "x" }), fields.xFrom, fields.xTo, fields.xlabel),
    renderElement("span", { class: "qmd-drawing-field-row" }, renderElement("span", { class: "qmd-drawing-field-label", text: "y" }), fields.yFrom, fields.yTo, fields.ylabel));
  el.addEventListener("input", () => {
    const model = apply();
    if (model && session.state.editingLabel === editing) { session.preview({ ...session.state, model }); }
  });
  el.addEventListener("keydown", (event) => {
    if (!takeKey(host, event, ["Enter"])) { return; }
    const model = apply();
    if (!model) { return; }
    session.update(applyEvent({ ...session.state, model }, key("Enter"), session.scale));
  });
  return { el, first: fields.xFrom };
}

function placeField(mounted: Mounted | null, spot: { at: Vec; kind: string }): void {
  if (!mounted) { return; }
  const axes = spot.kind === "axes";
  for (const [name, value] of Object.entries({ x: spot.at.x, y: spot.at.y, width: axes ? AXES_W : FIELD_W, height: axes ? AXES_H : FIELD_H })) {
    mounted.box.setAttribute(name, String(Math.round(value * 100) / 100));
  }
}

function mountField(host: FieldHost, editing: string): void {
  const state = host.session.state;
  const spot = target(state.model, editing);
  if (!spot) { return; }
  const box = document.createElementNS(SVG_NS, "foreignObject") as SVGForeignObjectElement;
  box.setAttribute("class", "qmd-drawing-field-box");
  let first: Field;
  if (spot.kind === "axes" && spot.axes) {
    const fields = axesFields(host, editing, spot.axes);
    box.append(fields.el);
    first = fields.first;
  } else {
    first = textField(host, editing, spot.value, spot.kind === "expr");
    box.append(first);
  }
  // The canvas handles pointer events on itself: the field's own clicks and double-clicks stay in the field.
  for (const type of ["pointerdown", "pointermove", "pointerup", "mousedown", "click", "dblclick"]) {
    box.addEventListener(type, (event) => event.stopPropagation());
  }
  host.mounted = { key: editing, openedWith: state.model, box, first };
  placeField(host.mounted, spot);
  host.session.canvas.append(box);
  first.focus({ preventScroll: true });
  first.select();
}

export function createLabelField(session: EditorSession): LabelField {
  const host: FieldHost = { session, mounted: null };
  return {
    sync() {
      const editing = session.state.editingLabel;
      if (host.mounted && host.mounted.key !== editing) { unmount(host); }
      if (editing === null) { return; }
      if (!host.mounted) { mountField(host, editing); return; }
      const spot = target(session.state.model, editing);
      if (spot) { placeField(host.mounted, spot); } else { unmount(host); }
    },
    destroy: () => unmount(host),
  };
}
