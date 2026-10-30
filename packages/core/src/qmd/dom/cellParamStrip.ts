// Draws a code cell's params as native controls (range, select, checkbox): dragging asks for debounced previews, at most one in
// flight and the latest value winning, and a release (the control's `change`) hands every value back once the preview ended.
import { renderElement } from "../../ui/dom/index.js";
import type { CellResult } from "../compute/index.js";
import { paramValues, type CellParam, type CellParamValue } from "../item/index.js";

/** A widget a run result declares for one of the cell's params (a Manipulate control). */
type CellControl = NonNullable<CellResult["controls"]>[number];

export type CellParamValues = Record<string, CellParamValue>;

const DEBOUNCE_MS = 150;
/** A log slider runs over positions 0..LOG_STEPS, position p meaning min * (max / min) ^ (p / LOG_STEPS). */
const LOG_STEPS = 1000;

export interface CellParamStripOptions {
  /** Starts a preview run with `values`; `done` must be called once when it ended, with or without a result. */
  preview(values: CellParamValues, done: () => void): void;
  /** A control was released: write `values` and run the cell with them. */
  release(values: CellParamValues): void;
}

export interface CellParamStrip {
  readonly el: HTMLElement;
  /** Draws `params`; the controls are rebuilt only when their shape changes, and keep a value being dragged. */
  render(params: readonly CellParam[], enabled: boolean): void;
  destroy(): void;
}

/** The params a run result's Manipulate controls describe; a control that is not a valid param is skipped. */
export function paramsFromControls(controls: readonly CellControl[]): CellParam[] {
  const params: CellParam[] = [];
  for (const control of controls) {
    const { name, value } = control;
    if (params.some((param) => param.name === name)) continue;
    if (control.kind === "slider" && typeof value === "number" && typeof control.min === "number" && typeof control.max === "number" && control.max > control.min) {
      params.push({ name, kind: "slider", min: control.min, max: control.max, ...(control.step === undefined ? {} : { step: control.step }), value: Math.min(Math.max(value, control.min), control.max) });
    } else if (control.kind === "select" && control.choices && control.choices.length > 0 && typeof value !== "boolean") {
      params.push({ name, kind: "select", choices: control.choices, value });
    } else if (control.kind === "checkbox" && typeof value === "boolean") {
      params.push({ name, kind: "checkbox", value });
    }
  }
  return params;
}

/** `param` with `value` in place of its own, when `value` fits its kind. */
export function withParamValue(param: CellParam, value: CellParamValue | undefined): CellParam {
  if (param.kind === "checkbox") return typeof value === "boolean" ? { ...param, value } : param;
  if (param.kind === "slider") return typeof value === "number" && Number.isFinite(value) ? { ...param, value } : param;
  return typeof value === "number" || typeof value === "string" ? { ...param, value } : param;
}

let idSeq = 0;

const isLog = (param: Extract<CellParam, { kind: "slider" }>): boolean => param.log === true && param.min > 0 && param.max > param.min;
const shownNumber = (value: number): string => String(Number(value.toPrecision(4)));

/** One control: its row and how to show a value set from outside. */
interface Row { el: HTMLElement; show(value: CellParamValue): void }

/** @returns an empty, hidden strip; `render` fills it. */
export function createCellParamStrip(options: CellParamStripOptions): CellParamStrip {
  const el = renderElement("div", { class: "qmd-param-strip", contenteditable: "false", hidden: true });
  let shape: string | null = null;
  let values: CellParamValues = {};
  let rows = new Map<string, Row>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let queued: CellParamValues | null = null;
  let released: CellParamValues | null = null;
  /** Between a control's first input and its release, so a redraw does not reset the value being dragged. */
  let dirty = false;
  let destroyed = false;

  const setBusy = (busy: boolean): void => { if (busy) el.setAttribute("aria-busy", "true"); else el.removeAttribute("aria-busy"); };
  const commit = (next: CellParamValues): void => { dirty = false; options.release(next); };
  const start = (next: CellParamValues): void => {
    inFlight = true;
    setBusy(true);
    let ended = false;
    options.preview(next, () => {
      if (ended || destroyed) return;
      ended = true;
      inFlight = false;
      setBusy(false);
      if (released) { const values = released; released = null; queued = null; commit(values); }
      else if (queued) { const values = queued; queued = null; start(values); }
    });
  };
  const changed = (name: string, value: CellParamValue): void => {
    dirty = true;
    values[name] = value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (inFlight) queued = { ...values }; else start({ ...values });
    }, DEBOUNCE_MS);
  };
  const release = (): void => {
    clearTimeout(timer);
    timer = undefined;
    queued = null;
    if (inFlight) released = { ...values }; else commit({ ...values });
  };

  const slider = (param: Extract<CellParam, { kind: "slider" }>, id: string, enabled: boolean): Row => {
    const log = isLog(param);
    const toValue = (position: number): number => (log ? Number((param.min * (param.max / param.min) ** (position / LOG_STEPS)).toPrecision(6)) : position);
    const toPosition = (value: number): number => (log ? Math.round((LOG_STEPS * Math.log(value / param.min)) / Math.log(param.max / param.min)) : value);
    const input = renderElement("input", { class: "qmd-param-range", type: "range", id,
      min: log ? 0 : param.min, max: log ? LOG_STEPS : param.max, step: log ? 1 : param.step ?? "any", disabled: !enabled });
    const text = renderElement("output", { class: "qmd-param-value", for: id });
    const show = (value: number): void => { text.textContent = shownNumber(value); input.setAttribute("aria-valuetext", shownNumber(value)); };
    input.value = String(toPosition(param.value));
    show(param.value);
    input.addEventListener("input", () => { const value = toValue(Number(input.value)); show(value); changed(param.name, value); });
    input.addEventListener("change", release);
    const row = renderElement("div", { class: "qmd-param qmd-param-slider" }, renderElement("label", { class: "qmd-param-name", for: id, text: param.name }), input, text);
    return { el: row, show: (value) => { if (typeof value !== "number") return; input.value = String(toPosition(value)); show(value); } };
  };

  const select = (param: Extract<CellParam, { kind: "select" }>, id: string, enabled: boolean): Row => {
    const input = renderElement("select", { class: "qmd-param-select", id, disabled: !enabled },
      ...param.choices.map((choice) => renderElement("option", { value: String(choice), text: String(choice) })));
    input.value = String(param.value);
    input.addEventListener("input", () => {
      const choice = param.choices.find((candidate) => String(candidate) === input.value);
      if (choice !== undefined) changed(param.name, choice);
    });
    input.addEventListener("change", release);
    const row = renderElement("div", { class: "qmd-param qmd-param-choice" }, renderElement("label", { class: "qmd-param-name", for: id, text: param.name }), input);
    return { el: row, show: (value) => { input.value = String(value); } };
  };

  const checkbox = (param: Extract<CellParam, { kind: "checkbox" }>, id: string, enabled: boolean): Row => {
    const input = renderElement("input", { class: "qmd-param-check", type: "checkbox", id, disabled: !enabled });
    input.checked = param.value;
    input.addEventListener("input", () => changed(param.name, input.checked));
    input.addEventListener("change", release);
    const row = renderElement("div", { class: "qmd-param qmd-param-toggle" }, input, renderElement("label", { class: "qmd-param-name", for: id, text: param.name }));
    return { el: row, show: (value) => { input.checked = value === true; } };
  };

  return {
    el,
    render(params, enabled) {
      const key = JSON.stringify([enabled, params.map((param) => ({ ...param, value: undefined }))]);
      if (key !== shape) {
        shape = key;
        dirty = false;
        values = paramValues([...params]);
        rows = new Map();
        for (const param of params) {
          const id = `qmd-param-${++idSeq}`;
          const row = param.kind === "slider" ? slider(param, id, enabled) : param.kind === "select" ? select(param, id, enabled) : checkbox(param, id, enabled);
          rows.set(param.name, row);
        }
        el.replaceChildren(...Array.from(rows.values(), (row) => row.el));
        el.hidden = params.length === 0;
        return;
      }
      if (dirty) return;
      for (const param of params) {
        if (values[param.name] === param.value) continue;
        values[param.name] = param.value;
        rows.get(param.name)?.show(param.value);
      }
    },
    destroy() { destroyed = true; clearTimeout(timer); },
  };
}
