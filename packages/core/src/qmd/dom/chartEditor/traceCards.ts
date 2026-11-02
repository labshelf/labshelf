// The trace cards of the data editor's Structure › Traces panel: per trace a name, Type, X, Y and Z column selects
// (several Z columns for grid types), an Options row (mode for scatter, Transpose for heatmap/contour/surface), reorder and remove.
import { renderElement } from "../../../ui/dom/index.js";
import { CHART_TRACE_TYPES, type ChartTable, type ChartTrace, type ChartTraceType } from "../../chart/index.js";

/** What a card asks of the editor; `change` gets the whole new trace. */
export interface TraceCardActions {
  change(index: number, trace: ChartTrace): void;
  remove(index: number): void;
  move(index: number, delta: -1 | 1): void;
}

const TYPE_LABELS: Record<ChartTraceType, string> = {
  scatter: "Scatter", bar: "Bar", pie: "Pie", heatmap: "Heatmap", contour: "Contour", surface: "Surface",
  mesh3d: "Mesh 3d", scatter3d: "Scatter 3d", histogram: "Histogram", box: "Box",
};
/** Types whose Z is a grid of several columns, which Transpose flips. */
const GRID_TYPES: readonly ChartTraceType[] = ["heatmap", "contour", "surface"];
/** Types that take one Z column. */
const POINT_3D_TYPES: readonly ChartTraceType[] = ["scatter3d", "mesh3d"];
const SCATTER_MODES: readonly { value: string; label: string }[] = [
  { value: "lines", label: "Lines" },
  { value: "markers", label: "Markers" },
  { value: "lines+markers", label: "Lines and markers" },
];

/** True when Z of this type is several columns (heatmap, contour, surface). */
function isGridTrace(type: ChartTraceType): boolean {
  return GRID_TYPES.includes(type);
}

/** The spreadsheet letter of a column index: 0 is A, 25 is Z, 26 is AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The label of a column in a select: its letter, then its header when the table has one. */
function columnLabel(table: ChartTable, index: number): string {
  const letter = columnLetter(index);
  const header = table.cols[index]?.name.trim() ?? "";
  return header === "" ? letter : `${letter} — ${header}`;
}

/** The trace after a type change: keys the new type does not use are dropped. */
function retypeTrace(trace: ChartTrace, type: ChartTraceType): ChartTrace {
  const next: ChartTrace = { ...trace, type };
  if (type !== "scatter") { delete next.mode; delete next.fill; }
  else if (next.mode === undefined) next.mode = "lines";
  if (!isGridTrace(type)) delete next.transpose;
  if (!isGridTrace(type) && !POINT_3D_TYPES.includes(type)) delete next.z;
  else if (POINT_3D_TYPES.includes(type) && next.z !== undefined && next.z.length > 1) next.z = next.z.slice(0, 1);
  return next;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return renderElement("label", { class: "qmd-chart-field" }, renderElement("span", { class: "qmd-chart-field-label", text: label }), control);
}

function select(label: string, options: readonly { value: string; label: string }[], value: string | readonly string[], multiple = false): HTMLSelectElement {
  const el = renderElement("select", { class: `qmd-chart-select${multiple ? " qmd-chart-select-multi" : ""}`, "aria-label": label });
  el.multiple = multiple;
  const chosen = typeof value === "string" ? [value] : value;
  for (const o of options) {
    const option = renderElement("option", { value: o.value, text: o.label });
    option.selected = chosen.includes(o.value);
    el.append(option);
  }
  if (!multiple && typeof value === "string") el.value = value;
  return el;
}

function columnOptions(table: ChartTable, withNone: boolean): { value: string; label: string }[] {
  const options = table.cols.map((_, i) => ({ value: columnLetter(i), label: columnLabel(table, i) }));
  return withNone ? [{ value: "", label: "None" }, ...options] : options;
}

function iconButton(label: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = renderElement("button", { class: "ls-btn qmd-chart-card-tool", type: "button", "aria-label": label, title: label, text });
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

/** What the parts of one card share: its trace, label prefix, table and the edits that go to the editor. */
interface CardEdit {
  trace: ChartTrace;
  table: ChartTable;
  prefix: string;
  change(next: ChartTrace): void;
  setKey<K extends keyof ChartTrace>(key: K, value: ChartTrace[K] | undefined): void;
}

/** The header row of a card: the name, move up and down, and remove. */
function cardHead(edit: CardEdit, index: number, count: number, actions: TraceCardActions): HTMLElement {
  const n = index + 1;
  const name = renderElement("input", { class: "qmd-chart-input qmd-chart-card-name", type: "text", "aria-label": `${edit.prefix} name`, placeholder: edit.prefix });
  name.value = edit.trace.name ?? "";
  name.addEventListener("change", () => edit.setKey("name", name.value.trim() === "" ? undefined : name.value.trim()));
  return renderElement("div", { class: "qmd-chart-card-head" },
    name,
    iconButton(`Move trace ${n} up`, "↑", () => actions.move(index, -1), index === 0),
    iconButton(`Move trace ${n} down`, "↓", () => actions.move(index, 1), index === count - 1),
    iconButton(`Remove trace ${n}`, "×", () => actions.remove(index)),
  );
}

/** The Z field of a grid type (several columns) or a 3d point type (one column); none for other types. */
function zField(edit: CardEdit): HTMLElement | null {
  const { trace, table, prefix, setKey } = edit;
  if (isGridTrace(trace.type)) {
    const z = select(`${prefix} Z columns`, columnOptions(table, false), trace.z ?? [], true);
    z.addEventListener("change", () => {
      const picked = [...z.selectedOptions].map((o) => o.value);
      setKey("z", picked.length === 0 ? undefined : picked);
    });
    return field("Z", z);
  }
  if (POINT_3D_TYPES.includes(trace.type)) {
    const z = select(`${prefix} Z`, columnOptions(table, true), trace.z?.[0] ?? "");
    z.addEventListener("change", () => setKey("z", z.value === "" ? undefined : [z.value]));
    return field("Z", z);
  }
  return null;
}

/** The Type, X, Y and Z selects of a card. */
function cardFields(edit: CardEdit): HTMLElement[] {
  const { trace, table, prefix, setKey } = edit;
  const type = select(`${prefix} type`, CHART_TRACE_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] })), trace.type);
  type.addEventListener("change", () => edit.change(retypeTrace(trace, type.value as ChartTraceType)));
  const x = select(`${prefix} X`, columnOptions(table, true), trace.x ?? "");
  x.addEventListener("change", () => setKey("x", x.value === "" ? undefined : x.value));
  const y = select(`${prefix} Y`, columnOptions(table, true), trace.y ?? "");
  y.addEventListener("change", () => setKey("y", y.value === "" ? undefined : y.value));
  const z = zField(edit);
  return [field("Type", type), field("X", x), field("Y", y), ...(z === null ? [] : [z])];
}

/** The Options row of a card: mode for scatter, Transpose for grid types. */
function cardOptions(edit: CardEdit): HTMLElement {
  const { trace, prefix, setKey } = edit;
  const options: HTMLElement[] = [];
  if (trace.type === "scatter") {
    const mode = select(`${prefix} mode`, SCATTER_MODES, trace.mode ?? "lines");
    mode.addEventListener("change", () => setKey("mode", mode.value));
    options.push(field("Mode", mode));
  }
  if (isGridTrace(trace.type)) {
    const transpose = renderElement("input", { class: "qmd-chart-check", type: "checkbox", "aria-label": `${prefix} transpose` });
    transpose.checked = trace.transpose === true;
    transpose.addEventListener("change", () => setKey("transpose", transpose.checked ? true : undefined));
    options.push(renderElement("label", { class: "qmd-chart-check-field" }, transpose, renderElement("span", { text: "Transpose" })));
  }
  return renderElement("div", { class: "qmd-chart-card-options" },
    renderElement("span", { class: "qmd-chart-field-label", text: "Options" }),
    ...(options.length === 0 ? [renderElement("span", { class: "qmd-chart-card-none", text: "None for this type" })] : options),
  );
}

/** The card of trace `index` (of `count`), its columns listed from `table`. */
export function renderTraceCard(trace: ChartTrace, index: number, count: number, table: ChartTable, actions: TraceCardActions): HTMLElement {
  const prefix = `Trace ${index + 1}`;
  const edit: CardEdit = {
    trace,
    table,
    prefix,
    change: (next) => actions.change(index, next),
    setKey(key, value) {
      const next: ChartTrace = { ...trace };
      if (value === undefined) delete next[key];
      else next[key] = value;
      actions.change(index, next);
    },
  };
  return renderElement("li", { class: "qmd-chart-card", "aria-label": prefix },
    cardHead(edit, index, count, actions),
    renderElement("div", { class: "qmd-chart-card-fields" }, ...cardFields(edit)),
    cardOptions(edit),
  );
}
