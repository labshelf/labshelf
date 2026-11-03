// The rows of the function plot dialog (D9): one per function with its colour dot, kind prefix, relation dropdown (y(x) and x(y) only),
// live expression fields that show a bad expression's message under them and put the caret at its offset on focus, the domains and steps of
// the sampled variables (t of a parametric curve, θ of a polar one; x and y of z = f(x,y), u and v of a parametric surface, t of a 3D curve),
// hide/show, delete (confirmed when not empty), and reordering by drag or Alt-↑/↓.
import { askDialog, renderElement, renderIcon, showPopover } from "../../../ui/dom/index.js";
import type { ChartFn } from "../../chart/index.js";
import { numberField } from "./fields.js";

/** The first bad expression of a function: its message, offset and part (from fnTraces2d). */
export type FnRowError = { message: string; at: number; part: number } | null;

/** What a row reports: a changed function (the rows keep their DOM), a removal, or a move from one place to another. */
export interface FnRowsHandlers {
  change(index: number, fn: ChartFn): void;
  remove(index: number): void;
  move(from: number, to: number): void;
}

export interface FnRows {
  el: HTMLElement;
  /** Rebuilds the rows from `fns`, keeping focus on the same control of the same function when it had it. */
  render(fns: readonly ChartFn[]): void;
  /** Marks each row's bad field, or clears it; an empty field is never marked. */
  showErrors(errors: readonly FnRowError[]): void;
  /** Focuses the first expression field of the row at `index`. */
  focusRow(index: number): void;
}

type Rel = NonNullable<ChartFn["rel"]>;

const RELATIONS: readonly { value: Rel; label: string }[] = [
  { value: "=", label: "=" }, { value: "<", label: "<" }, { value: ">", label: ">" }, { value: "<=", label: "≤" }, { value: ">=", label: "≥" },
];

/** What a row of each kind shows: its prefix, the names of its expression fields and the sampled variables whose domains it edits (one or two). */
function shape(fn: ChartFn): { prefix: string; parts: string[]; suffix?: string; params?: string[] } {
  switch (fn.kind) {
    case "y": return { prefix: "y(x)", parts: ["y(x)"] };
    case "x": return { prefix: "x(y)", parts: ["x(y)"] };
    case "param": return { prefix: "x(t), y(t) =", parts: ["x(t)", "y(t)"], params: ["t"] };
    case "polar": return { prefix: "r(θ) =", parts: ["r(θ)"], params: ["θ"] };
    case "surface": return { prefix: "z(x,y) =", parts: ["z(x, y)"], params: ["x", "y"] };
    case "param3d": return { prefix: "x(u,v), y(u,v), z(u,v) =", parts: ["x(u, v)", "y(u, v)", "z(u, v)"], params: ["u", "v"] };
    case "curve3d": return { prefix: "x(t), y(t), z(t) =", parts: ["x(t)", "y(t)", "z(t)"], params: ["t"] };
    case "implicit": return fn.expr.length > 1
      ? { prefix: "", parts: ["Left side", "Right side"] }
      : { prefix: "F(x,y) =", parts: ["F(x, y)"], suffix: "= 0" };
    default: return { prefix: fn.kind, parts: fn.expr.map((_, i) => `Expression ${i + 1}`) };
  }
}

/** The name of a row for its buttons' titles. */
function rowName(fn: ChartFn, index: number): string {
  const s = shape(fn);
  return `function ${index + 1} (${s.prefix === "" ? "implicit" : s.prefix.replace(/\s*=$/, "")})`;
}

function iconButton(className: string, label: string, icon: Parameters<typeof renderIcon>[0]): HTMLButtonElement {
  const b = renderElement("button", { class: `ls-btn qmd-chart-fn-tool ${className}`, type: "button", "aria-label": label, title: label });
  b.innerHTML = renderIcon(icon);
  return b;
}

/** The colour dot: a swatch button opening the palette. */
function colourDot(fn: ChartFn, index: number, palette: readonly string[], set: (colour: string) => void): HTMLButtonElement {
  const dot = renderElement("button", { class: "qmd-chart-fn-dot", type: "button", "aria-haspopup": "menu", "data-role": "dot" });
  const show = (colour: string): void => {
    const name = `Colour of ${rowName(fn, index)}: ${colour}`;
    dot.title = name;
    dot.setAttribute("aria-label", name);
    dot.style.setProperty("--qmd-chart-swatch", colour);
  };
  show(fn.color ?? palette[index % palette.length] ?? "#888888");
  dot.addEventListener("click", () => {
    showPopover(dot, (close) => {
      const menu = renderElement("div", { class: "ls-menu qmd-chart-swatches", role: "menu", "aria-label": "Palette" });
      palette.forEach((colour, i) => {
        const name = `Colour ${i + 1} (${colour})`;
        const swatch = renderElement("button", { class: "qmd-chart-swatch", type: "button", role: "menuitem", title: name, "aria-label": name });
        swatch.style.setProperty("--qmd-chart-swatch", colour);
        swatch.addEventListener("click", () => { close(); show(colour); set(colour.toLowerCase()); });
        menu.append(swatch);
      });
      return menu;
    });
  });
  return dot;
}

interface ExprField { input: HTMLInputElement; message: HTMLElement; box: HTMLElement }

/** One expression field with its message line; focusing it while invalid puts the caret at the error. */
function exprField(label: string, value: string, part: number, onInput: (text: string) => void): ExprField {
  const input = renderElement("input", { class: "qmd-chart-input qmd-chart-fn-expr", type: "text", spellcheck: "false", autocomplete: "off", "aria-label": label, "data-role": `part-${part}` });
  input.value = value;
  const message = renderElement("div", { class: "qmd-chart-fn-message", role: "status" });
  message.hidden = true;
  input.addEventListener("input", () => onInput(input.value));
  input.addEventListener("focus", () => {
    const at = input.dataset.errorAt;
    if (at === undefined) return;
    const n = Math.min(Number(at), input.value.length);
    input.setSelectionRange(n, n);
  });
  return { input, message, box: renderElement("div", { class: "qmd-chart-fn-field" }, input, message) };
}

function markField(field: ExprField, error: { message: string; at: number } | null): void {
  const { input, message } = field;
  const bad = error !== null && input.value.trim() !== "";
  input.classList.toggle("is-invalid", bad);
  if (bad) {
    input.setAttribute("aria-invalid", "true");
    input.dataset.errorAt = String(error.at);
    message.textContent = `${error.message} (at character ${error.at + 1})`;
  } else {
    input.removeAttribute("aria-invalid");
    delete input.dataset.errorAt;
    message.textContent = "";
  }
  message.hidden = !bad;
}

/** The steps a row stores for its `count` sampled variables: a number for one, a pair for two (one number when only one is given), or none. */
function stepsValue(steps: readonly (number | null)[]): ChartFn["steps"] | undefined {
  const [a = null, b = null] = steps;
  if (steps.length < 2) return a ?? undefined;
  if (a !== null && b !== null) return [a, b];
  return a ?? b ?? undefined;
}

/** The '<min> ≤ v ≤ <max>' fields of each sampled variable (fn.domain, then fn.domain2) and a steps field per variable (fn.steps); edits apply to the row's latest function (`get`). */
function domainFields(fn: ChartFn, params: readonly string[], get: () => ChartFn, write: (fn: ChartFn) => void): HTMLElement {
  const keys = ["domain", "domain2"] as const;
  const box = renderElement("div", { class: "qmd-chart-fn-domain" });
  params.forEach((param, i) => {
    const key = keys[i] ?? "domain";
    const stored = fn[key];
    const pending: [number | null, number | null] = stored ? [stored[0], stored[1]] : [null, null];
    const applyDomain = (): void => {
      const [lo, hi] = pending;
      const next = { ...get() };
      if (lo !== null && hi !== null) next[key] = [lo, hi];
      else delete next[key];
      write(next);
    };
    box.append(
      numberField(`${param} min`, pending[0], (v) => { pending[0] = v; applyDomain(); }, { allowEmpty: true }),
      renderElement("span", { class: "qmd-chart-fn-rel", "aria-hidden": "true", text: `≤ ${param} ≤` }),
      numberField(`${param} max`, pending[1], (v) => { pending[1] = v; applyDomain(); }, { allowEmpty: true }));
  });
  const stored = fn.steps;
  const steps: (number | null)[] = params.map((_, i) => (Array.isArray(stored) ? stored[i] ?? null : stored ?? null));
  params.forEach((param, i) => {
    box.append(numberField(params.length > 1 ? `Steps ${param}` : "Steps", steps[i] ?? null, (v) => {
      steps[i] = v === null ? null : Math.max(2, Math.round(v));
      const next = { ...get() };
      const value = stepsValue(steps);
      if (value === undefined) delete next.steps;
      else next.steps = value;
      write(next);
    }, { step: 1, min: 2, allowEmpty: true }));
  });
  return box;
}

interface Row { el: HTMLElement; fields: ExprField[] }

/** The relation dropdown of a y(x) or x(y) row. */
function relationSelect(fn: ChartFn, index: number, get: () => ChartFn, set: (fn: ChartFn) => void): HTMLSelectElement {
  const select = renderElement("select", { class: "qmd-chart-select qmd-chart-fn-relation", "aria-label": `Relation of ${rowName(fn, index)}`, "data-role": "rel" });
  for (const r of RELATIONS) select.append(renderElement("option", { value: r.value, text: r.label }));
  select.value = fn.rel ?? "=";
  select.addEventListener("change", () => {
    const next = { ...get() };
    if (select.value === "=") delete next.rel;
    else next.rel = select.value as Rel;
    set(next);
  });
  return select;
}

/** The expression fields of a row, joined by '=' (implicit) or ',' and followed by the kind's suffix. */
function exprsBox(fn: ChartFn, fields: readonly ExprField[], suffix: string | undefined): HTMLElement {
  const exprs = renderElement("div", { class: "qmd-chart-fn-exprs" });
  fields.forEach((f, i) => {
    if (i > 0) exprs.append(renderElement("span", { class: "qmd-chart-fn-rel", "aria-hidden": "true", text: fn.kind === "implicit" ? "=" : "," }));
    exprs.append(f.box);
  });
  if (suffix !== undefined) exprs.append(renderElement("span", { class: "qmd-chart-fn-rel", text: suffix }));
  return exprs;
}

/** The hide/show button of a row; it toggles `hidden` on the row's latest function and the row's look. */
function eyeButton(fn: ChartFn, index: number, el: HTMLElement, get: () => ChartFn, set: (fn: ChartFn) => void): HTMLButtonElement {
  const eye = iconButton("qmd-chart-fn-eye", "", fn.hidden === true ? "eye-off" : "eye");
  eye.dataset.role = "eye";
  const showEye = (): void => {
    const hidden = get().hidden === true;
    const label = `${hidden ? "Show" : "Hide"} ${rowName(fn, index)}`;
    eye.title = label;
    eye.setAttribute("aria-label", label);
    eye.setAttribute("aria-pressed", String(hidden));
    eye.innerHTML = renderIcon(hidden ? "eye-off" : "eye");
    el.classList.toggle("is-hidden", hidden);
  };
  showEye();
  eye.addEventListener("click", () => {
    const next = { ...get() };
    if (next.hidden === true) delete next.hidden;
    else next.hidden = true;
    set(next);
    showEye();
  });
  return eye;
}

/** The delete button of a row; a function with text is removed only after the dialog. */
function deleteButton(fn: ChartFn, index: number, get: () => ChartFn, h: FnRowsHandlers): HTMLButtonElement {
  const del = iconButton("qmd-chart-fn-delete", `Delete ${rowName(fn, index)}`, "trash");
  del.dataset.role = "delete";
  del.addEventListener("click", () => {
    if (get().expr.every((e) => e.trim() === "")) { h.remove(index); return; }
    void askDialog("Delete this function?", `${get().expr.join(", ")} is removed from the plot.`, "Delete", true).then((yes) => { if (yes) h.remove(index); });
  });
  return del;
}

/** One row; it keeps its latest function so its own edits add up. */
function renderRow(fn: ChartFn, index: number, palette: readonly string[], h: FnRowsHandlers): Row {
  let current = fn;
  const get = (): ChartFn => current;
  const set = (next: ChartFn): void => { current = next; h.change(index, next); };
  const s = shape(fn);
  const el = renderElement("li", { class: "qmd-chart-fn-row", draggable: "true", "data-index": String(index) });
  el.classList.toggle("is-hidden", fn.hidden === true);
  const fields = s.parts.map((label, part) => exprField(label, fn.expr[part] ?? "", part, (text) => {
    const expr = s.parts.map((_, i) => current.expr[i] ?? "");
    expr[part] = text;
    set({ ...current, expr });
  }));
  const head = renderElement("div", { class: "qmd-chart-fn-head" },
    renderElement("span", { class: "qmd-chart-fn-grip", title: "Drag to reorder (or Alt+↑ / Alt+↓)", "aria-hidden": "true", text: "⋮⋮" }),
    colourDot(fn, index, palette, (color) => set({ ...current, color })));
  if (s.prefix !== "") head.append(renderElement("span", { class: "qmd-chart-fn-prefix", text: s.prefix }));
  if (fn.kind === "y" || fn.kind === "x") head.append(relationSelect(fn, index, get, set));
  head.append(exprsBox(fn, fields, s.suffix), eyeButton(fn, index, el, get, set), deleteButton(fn, index, get, h));
  el.append(head);
  if (s.params !== undefined) el.append(domainFields(fn, s.params, get, set));
  return { el, fields };
}

/** The index of the row of `list` that holds `target`, or null. */
function rowIndex(list: HTMLElement, target: EventTarget | null): number | null {
  const row = target instanceof Element ? target.closest<HTMLElement>(".qmd-chart-fn-row") : null;
  return row === null || !list.contains(row) ? null : Number(row.dataset.index);
}

/** The reordering of the rows: Alt-↑/↓ on a focused row and drag and drop, each reported as `h.move(from, to)`. */
function bindReorder(el: HTMLElement, h: FnRowsHandlers, count: () => number): void {
  let dragFrom: number | null = null;
  const indexOf = (target: EventTarget | null): number | null => rowIndex(el, target);
  el.addEventListener("keydown", (event) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const from = indexOf(event.target);
    if (from === null) return;
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    event.preventDefault();
    if (to < 0 || to >= count()) return;
    h.move(from, to);
  });
  el.addEventListener("dragstart", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) { event.preventDefault(); return; }
    dragFrom = indexOf(event.target);
    if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
  });
  el.addEventListener("dragover", (event) => { if (dragFrom !== null) event.preventDefault(); });
  el.addEventListener("drop", (event) => {
    const to = indexOf(event.target);
    const from = dragFrom;
    dragFrom = null;
    if (from === null || to === null || from === to) return;
    event.preventDefault();
    h.move(from, to);
  });
  el.addEventListener("dragend", () => { dragFrom = null; });
}

/** Mounts the list of function rows; `palette` gives the dot of a function without its own colour. */
export function mountFnRows(palette: readonly string[], h: FnRowsHandlers): FnRows {
  const el = renderElement("ol", { class: "qmd-chart-fn-rows", "aria-label": "Functions" });
  let rows: Row[] = [];
  let count = 0;
  bindReorder(el, h, () => count);

  return {
    el,
    render(fns) {
      const active = document.activeElement;
      const at = active instanceof HTMLElement ? rowIndex(el, active) : null;
      const role = active instanceof HTMLElement ? active.dataset.role : undefined;
      count = fns.length;
      rows = fns.map((fn, i) => renderRow(fn, i, palette, h));
      el.replaceChildren(...rows.map((r) => r.el));
      if (fns.length === 0) el.append(renderElement("li", { class: "qmd-chart-panel-note", text: "No functions yet. Use + Add to plot one." }));
      if (at !== null && role !== undefined) rows[at]?.el.querySelector<HTMLElement>(`[data-role="${role}"]`)?.focus();
    },
    showErrors(errors) {
      rows.forEach((row, i) => {
        const error = errors[i] ?? null;
        row.fields.forEach((field, part) => markField(field, error !== null && error.part === part ? error : null));
      });
    },
    focusRow(index) {
      rows[index]?.fields[0]?.input.focus();
    },
  };
}
