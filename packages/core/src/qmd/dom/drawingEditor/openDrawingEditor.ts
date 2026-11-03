// Opens the drawing editor in place (decisions D6 to D10): a toolbar and an SVG canvas inside the host, pointer and keyboard events turned into session 4's pure editor events, the drawing re-rendered live through layout and formatDrawingSvg, one undo step per completed gesture, labels typeset through parseMathSvg, broken labels and expressions named in a status line and blocking the commit, and Done, Esc or a click outside the editor handing the model to `done`. Lazy entry `@labshelf/core/drawingEditor`; MathJax is reached only through loadCoreMath of latex/hover.
import * as coreMath from "../../../latex/hover/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { parseMathSvg, svgDimension } from "./mathSvg.js";
import { parseExpr, layoutDrawing, type LabelBox, type DrawingStyle, formatDrawingSvg } from "../../../drawing/index.js";
import { brokenLabelMarkup, createCanvas, type Canvas } from "./canvas.js";
import { applyEvent, type EditorEvent } from "./gestures.js";
import { createLabelField, type LabelField } from "./labelField.js";
import { createEditorState, createHistory, itemIndexOf, type EditorHistory, type EditorState, type Tool } from "./state.js";
import { createToolbar, type Toolbar } from "./toolbar.js";

type MathApi = Awaited<ReturnType<typeof coreMath.loadCoreMath>>;
type DrawingModel = import("../../../drawing/index.js").DrawingModel;

/** The box a label gets while MathJax is still loading (svg.ts's default). */
const LOADING_LABEL: LabelBox = { width: 10, height: 14 };

/** Typeset labels kept per TeX source; cleared past this many. */
const TYPESET_CACHE = 500;

/** What labelField.ts works with: the live state, the elements it mounts in, `update` (a changed model is one undo step) and `preview` (shown live, no undo step: a field being typed in). */
export interface EditorSession { readonly state: EditorState; readonly root: HTMLElement; readonly canvas: SVGSVGElement; readonly scale: number; update(next: EditorState): void; preview(next: EditorState): void }

/** Something in the drawing that does not parse: a label's TeX or a function's expression. */
interface Broken { kind: "label" | "expression"; source: string; message: string }

/** The math API of the latex/hover entry: through its loadCoreMath, or the entry itself when it is provided without one. */
function loadMath(): Promise<MathApi> {
  const entry = coreMath as Partial<typeof coreMath>;
  return typeof entry.loadCoreMath === "function" ? entry.loadCoreMath() : Promise.resolve(entry as MathApi);
}

/** Every TeX source the model shows as a label. */
function labelSources(model: DrawingModel): string[] {
  const out = model.points.flatMap((p) => p.label ? [p.label] : []);
  for (const item of model.items) {
    switch (item.k) {
      case "seg": case "fn": if (item.label) { out.push(item.label); } break;
      case "text": if (item.tex) { out.push(item.tex); } break;
      case "axes": for (const tex of [item.xlabel, item.ylabel]) { if (tex) { out.push(tex); } } break;
      default: break;
    }
  }
  return out;
}

function statusText(broken: readonly Broken[]): string {
  if (broken.length === 0) { return ""; }
  const parts = broken.map((b) => `${b.kind === "label" ? "Label" : "Expression"} ${b.source} does not parse${b.message ? ` (${b.message})` : ""}`);
  return `${parts.join("; ")}. Fix or undo it before Done.`;
}

/** Applies a style to the selected items that carry one (segments, circles, rectangles, polygons, functions). */
function restyleSelection(state: EditorState, style: DrawingStyle): EditorState {
  const indexes = new Set([...state.selection].map(itemIndexOf).filter((index): index is number => index !== null));
  if (indexes.size === 0) { return state; }
  const items = state.model.items.map((item, index) => {
    if (!indexes.has(index) || item.k === "text" || item.k === "axes") { return item; }
    const { style: _old, ...rest } = item;
    return Object.keys(style).length > 0 ? { ...rest, style: { ...style } } : rest;
  });
  return { ...state, model: { ...state.model, items } };
}

/** Two presses within this many ms and screen px of each other are a double press. */
const DOUBLE_MS = 500;
const DOUBLE_PX = 6;

/** The text of a thrown TeX error: its message, also when MathJax throws a plain object carrying one. */
function errorText(error: unknown): string {
  if (error instanceof Error) { return error.message; }
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string") { return (error as { message: string }).message; }
  return typeof error === "string" ? error : "";
}

const ESCAPE: EditorEvent = { type: "key", key: "Escape", shift: false, mod: false };

/** The status notice's mark (in the toolbar's icon style): a ring with an exclamation. */
const STATUS_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.75"/><path d="M8 5v3.5M8 11v0"/></svg>';

// ---- labels: typesetting and measuring ----

type Typeset = { markup: string; error: string | null };

/** Labels as MathJax typesets them, cached per TeX source; before setMath they measure as LOADING_LABEL and render as nothing. */
interface Labels { setMath(api: MathApi): void; typeset(tex: string): Typeset | null; render(tex: string): string; measure(tex: string): LabelBox }

function createLabels(): Labels {
  let math: MathApi | null = null;
  const cache = new Map<string, Typeset>();
  /** The label as style-free SVG markup, or its boxed source when MathJax rejects it; null while MathJax loads. */
  const typeset = (tex: string): Typeset | null => {
    if (!math) { return null; }
    const cached = cache.get(tex);
    if (cached) { return cached; }
    let out: Typeset;
    try {
      const svg = parseMathSvg(math.renderMathSvg(tex, false));
      svg.removeAttribute("style");
      out = { markup: svg.outerHTML, error: null };
    } catch (error) {
      out = { markup: brokenLabelMarkup(tex), error: errorText(error) };
    }
    if (cache.size >= TYPESET_CACHE) { cache.clear(); }
    cache.set(tex, out);
    return out;
  };
  const render = (tex: string): string => typeset(tex)?.markup ?? "";
  return {
    setMath: (api) => { math = api; },
    typeset,
    render,
    measure(tex) {
      if (!math) { return LOADING_LABEL; }
      const markup = render(tex);
      return { width: svgDimension(markup, "width"), height: svgDimension(markup, "height") };
    },
  };
}

function findBroken(labels: Labels, drawing: DrawingModel): Broken[] {
  const out: Broken[] = [];
  for (const source of new Set(labelSources(drawing))) {
    const error = labels.typeset(source)?.error;
    if (error !== undefined && error !== null) { out.push({ kind: "label", source, message: error }); }
  }
  for (const item of drawing.items) {
    if (item.k !== "fn") { continue; }
    const parsed = parseExpr(item.expr);
    if (!parsed.ok) { out.push({ kind: "expression", source: item.expr, message: parsed.error }); }
  }
  return out;
}

// ---- the open editor: session, history and rendering ----

/** Everything an open editor holds; the functions below act on it. */
interface Editor {
  history: EditorHistory;
  current: EditorState;
  closed: boolean;
  pointer: { at: { x: number; y: number }; shift: boolean; alt: boolean } | null;
  broken: Broken[];
  labelField: LabelField | null;
  /** The last press that may start a double press (client px), whether the current press is the second of one, and whether its double was already handled (so the browser's dblclick is not applied twice). */
  press: { last: { time: number; x: number; y: number } | null; second: boolean; handled: boolean };
  readonly labels: Labels;
  readonly canvas: Canvas;
  readonly toolbar: Toolbar;
  readonly status: HTMLElement;
  readonly root: HTMLElement;
  readonly done: (model: DrawingModel | null) => void;
  readonly onOutside: (event: Event) => void;
}

function render(ed: Editor): void {
  const { current, history, labels, canvas, status } = ed;
  const layout = layoutDrawing(current.model, labels.measure);
  canvas.render(current, layout, formatDrawingSvg(current.model, layout, labels.render), ed.pointer, labels.measure);
  ed.toolbar.update(current.tool, current.style, history.undo() !== history, history.redo() !== history);
  ed.broken = findBroken(labels, current.model);
  status.lastElementChild!.textContent = statusText(ed.broken);
  status.hidden = ed.broken.length === 0;
  status.classList.remove("is-blocking");
  ed.labelField?.sync();
}

/** Shows `next` without recording an undo step: the text of a field being typed in. */
function preview(ed: Editor, next: EditorState): void {
  if (ed.closed) { return; }
  ed.current = next;
  render(ed);
}

/** Makes `next` the live state; a changed model is one undo step. */
function update(ed: Editor, next: EditorState): void {
  if (ed.closed) { return; }
  if (next.model !== ed.history.state.model) { ed.history = ed.history.push(next); }
  ed.current = next;
  render(ed);
}

function step(ed: Editor, direction: "undo" | "redo"): void {
  const moved = ed.history[direction]();
  if (ed.closed || moved === ed.history) { return; }
  ed.history = moved;
  ed.current = { ...moved.state, tool: ed.current.tool, style: ed.current.style, draft: null, editingLabel: null };
  render(ed);
}

// ---- commit ----

/** Stops reacting; the DOM stays until destroy(), since the host view removes it (done is called once). */
function teardown(ed: Editor): void {
  ed.closed = true;
  document.removeEventListener("pointerdown", ed.onOutside, true);
  ed.labelField?.destroy();
}

function commit(ed: Editor): void {
  if (ed.closed) { return; }
  if (ed.broken.length > 0) {
    // A broken label or expression never reaches the document: the status line says what to fix.
    ed.status.classList.add("is-blocking");
    return;
  }
  const final = ed.current.editingLabel !== null ? applyEvent(ed.current, ESCAPE, ed.canvas.scale()) : ed.current;
  teardown(ed);
  ed.done(final.model);
}

// ---- pointer and keyboard input ----

function pointerEvent(ed: Editor, type: "down" | "move" | "up" | "dblclick", event: MouseEvent): void {
  const at = ed.canvas.toGrid(event);
  ed.pointer = { at, shift: event.shiftKey, alt: event.altKey };
  const target = type === "move" ? null : ed.canvas.hit(at);
  update(ed, applyEvent(ed.current, { type, x: at.x, y: at.y, shift: event.shiftKey, alt: event.altKey, mod: event.metaKey || event.ctrlKey, target }, ed.canvas.scale()));
}

/** Records a press; the second of two quick presses at one spot is a double press. The canvas content is rebuilt on every render, so the browser may detach the pressed element and fire no dblclick: the double is detected here instead. */
function notePress(ed: Editor, event: MouseEvent): void {
  const now = Date.now();
  const last = ed.press.last;
  const second = last !== null && now - last.time <= DOUBLE_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_PX;
  ed.press = { last: second ? null : { time: now, x: event.clientX, y: event.clientY }, second, handled: false };
}

function attachPointer(ed: Editor): void {
  const el = ed.canvas.el;
  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) { return; }
    notePress(ed, event);
    event.preventDefault();
    el.focus({ preventScroll: true });
    if ("pointerId" in event && typeof el.setPointerCapture === "function") {
      try { el.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
    }
    pointerEvent(ed, "down", event);
  });
  el.addEventListener("pointermove", (event) => { if (ed.current.draft) { pointerEvent(ed, "move", event); } });
  el.addEventListener("pointerup", (event) => {
    pointerEvent(ed, "up", event);
    if (!ed.press.second) { return; }
    ed.press = { ...ed.press, second: false, handled: true };
    pointerEvent(ed, "dblclick", event);
  });
  el.addEventListener("dblclick", (event) => {
    if (ed.press.handled) { ed.press = { ...ed.press, handled: false }; return; }
    pointerEvent(ed, "dblclick", event);
  });
  document.addEventListener("pointerdown", ed.onOutside, true);
}

function onKey(ed: Editor, event: KeyboardEvent): void {
  const mod = event.metaKey || event.ctrlKey;
  const lower = event.key.toLowerCase();
  const history = mod && (lower === "z" || lower === "y");
  // Keys typed in the open editor stay in it: the note's ProseMirror never sees them (its ⌘Z would undo the drawing's insert). Other shortcuts (⌘S) still reach the host.
  if (!mod || history) { event.stopPropagation(); }
  const tag = event.target instanceof Element ? event.target.tagName : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") { return; }
  if (history) {
    event.preventDefault();
    step(ed, event.shiftKey || lower === "y" ? "redo" : "undo");
    return;
  }
  const current = ed.current;
  if (event.key === "Escape") {
    // Esc cancels the gesture, then clears the selection or closes the field, then closes the editor.
    event.preventDefault();
    if (current.draft || current.selection.size > 0 || current.editingLabel !== null) { update(ed, applyEvent(current, ESCAPE, ed.canvas.scale())); } else { commit(ed); }
    return;
  }
  const next = applyEvent(current, { type: "key", key: event.key, shift: event.shiftKey, mod }, ed.canvas.scale());
  if (next !== current) {
    event.preventDefault();
    event.stopPropagation();
    update(ed, next);
  }
}

// ---- opening ----

function createEditor(host: HTMLElement, model: DrawingModel, done: (model: DrawingModel | null) => void): Editor {
  const history = createHistory(createEditorState(model));
  const canvas = createCanvas();
  const toolbar = createToolbar({
    setTool: (tool: Tool) => update(ed, { ...ed.current, tool, draft: null }),
    setStyle: (style) => update(ed, restyleSelection({ ...ed.current, style }, style)),
    undo: () => step(ed, "undo"),
    redo: () => step(ed, "redo"),
    done: () => commit(ed),
  });
  // The notice carries an icon as well as its colour, so a blocked Done reads without colour alone; the text is what render() fills.
  const status = renderElement("div", { class: "qmd-drawing-status", role: "status", "aria-live": "polite" }, renderElement("span", { class: "qmd-drawing-status-icon", html: STATUS_ICON }), renderElement("span", { class: "qmd-drawing-status-text" }));
  status.hidden = true;
  const root = renderElement("div", { class: "qmd-drawing-editor-root" }, toolbar.el, canvas.el, status);
  host.append(root);
  const ed: Editor = {
    history, current: history.state, closed: false, pointer: null, broken: [], labelField: null, press: { last: null, second: false, handled: false },
    labels: createLabels(), canvas, toolbar, status, root, done,
    onOutside: (event) => {
      const target = event.target;
      if (target instanceof Node && root.contains(target)) { return; }
      commit(ed);
    },
  };
  const session: EditorSession = {
    get state() { return ed.current; },
    root,
    canvas: canvas.el,
    get scale() { return canvas.scale(); },
    update: (next) => update(ed, next),
    preview: (next) => preview(ed, next),
  };
  ed.labelField = createLabelField(session);
  return ed;
}

export function openDrawingEditor(host: HTMLElement, model: import("../../../drawing/index.js").DrawingModel, done: (model: import("../../../drawing/index.js").DrawingModel | null) => void): { destroy(): void } {
  const ed = createEditor(host, model, done);
  attachPointer(ed);
  ed.root.addEventListener("keydown", (event) => onKey(ed, event));
  render(ed);
  ed.canvas.el.focus({ preventScroll: true });
  void loadMath().then((api) => {
    if (ed.closed) { return; }
    ed.labels.setMath(api);
    render(ed);
  }, () => { /* labels stay unrendered when MathJax does not load */ });
  return { destroy: () => { teardown(ed); ed.root.remove(); } };
}
