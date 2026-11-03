// The chart editor: a fullscreen overlay over the note with the editor of the chart's kind, Cancel / Apply / Ok,
// its own Escape order (leave an open field, then ask before discarding changes, then close) and the commit that writes a
// large table to its CSV through the note files first, then hands the model and its exported PNG to the note.
// The PNG a chart block stores for paper is the figure drawn by Plotly into a detached element at a fixed size on a white page,
// read back through Plotly.toImage, then purged. The commit (plan charts, D4/D5) places the table inline or in assets/<id>.csv
// and writes the CSV before the block is handed to the note, so a block never points at a file that was not written.
import { askDialog, mountOverlay, renderElement } from "../../../ui/dom/index.js";
import { chartFigure, EXPORT_THEME, chartKindLabel, placeTable, type ChartFigure, type ChartModel, type ChartTable } from "../../chart/index.js";
import type { EditorPlotly, EditorPlotlyLoader } from "./editorPlotly.js";
import type { ChartEditorFiles } from "./index.js";
import { mountDataEditor } from "./dataEditor.js";
import { mountFnEditor } from "./fnEditor.js";
import { chartOfTile, renderChartPicker } from "./picker.js";

/** The PNG a written chart block stores. */
export interface ChartPng { dataUrl: string; widthCm: number; alt: string }

/**
 * What the note gives the editor; `done` gets each write (Apply, Ok) and null when the editor closes without writing.
 * For a block with `src`, `table` is the CSV the note read, or `missing` the note shown when it could not (the grid is then read-only);
 * `files` writes a large table to assets/<id>.csv before `done`, and without it a table stays inline.
 */
export interface ChartEditorHost { model: ChartModel | null; loadPlotly: EditorPlotlyLoader; files?: ChartEditorFiles; table?: ChartTable; missing?: string; done(result: { model: ChartModel; png: ChartPng | null } | null): void }

const DISCARD_TITLE = "Discard changes to this chart?";
const DISCARD_MESSAGE = "The changes made in the editor are not written to the note.";
/** The width the exported PNG is placed at in the note (plan D6). */
const PNG_WIDTH_CM = 16;
const FIELDS = "input, select, textarea, [contenteditable='true'], [contenteditable='']";

const altOf = (model: ChartModel): string => model.title?.trim() || `${chartKindLabel(model.kind)} chart`;

/** The model's PNG for the block, or null when Plotly does not load or cannot export it. */
async function takePng(loadPlotly: EditorPlotlyLoader, model: ChartModel, table: ChartTable | null): Promise<ChartPng | null> {
  try {
    const plotly = await loadPlotly();
    const dataUrl = await exportChartPng(plotly, chartFigure(model, table, EXPORT_THEME));
    return dataUrl === null ? null : { dataUrl, widthCm: PNG_WIDTH_CM, alt: altOf(model) };
  } catch {
    return null;
  }
}

const DEFAULT_SIZE = { widthPx: 640, heightPx: 400 };
const SCALE = 2;
const PAPER = "#ffffff";
const CONFIG = { displaylogo: false, displayModeBar: false, staticPlot: true };

/** The PNG data URL of `figure` drawn at `size` (640x400 px by default) and scale 2; null when Plotly cannot draw or export it. */
export async function exportChartPng(plotly: EditorPlotly, figure: ChartFigure, size?: { widthPx: number; heightPx: number }): Promise<string | null> {
  const { widthPx, heightPx } = size ?? DEFAULT_SIZE;
  const root = document.createElement("div");
  root.className = "qmd-chart-export";
  const layout = { ...figure.layout, width: widthPx, height: heightPx, autosize: false, paper_bgcolor: PAPER, plot_bgcolor: PAPER };
  try {
    await plotly.react(root, figure.data, layout, CONFIG);
    return await plotly.toImage(root, { format: "png", width: widthPx, height: heightPx, scale: SCALE });
  } catch {
    return null;
  } finally {
    try { plotly.purge(root); } catch { /* the detached element goes with this call */ }
  }
}

/** The model to write with `table` placed; a large table is written to its CSV first, and stays inline without `files`. A failed write gives its message and no model. */
export async function commitChart(model: ChartModel, table: ChartTable, files: ChartEditorFiles | undefined): Promise<{ model: ChartModel; error: null } | { model: null; error: string }> {
  if (files === undefined) {
    const { src: _src, ...rest } = model;
    return { model: { ...rest, data: table }, error: null };
  }
  const placed = placeTable(model, table);
  if (placed.csv === null) return { model: placed.model, error: null };
  try {
    await files.write(placed.csv.path, new TextEncoder().encode(placed.csv.text));
  } catch (error) {
    return { model: null, error: error instanceof Error ? error.message : String(error) };
  }
  return { model: placed.model, error: null };
}

function button(label: string, primary = false): HTMLButtonElement {
  return renderElement("button", { class: `ls-btn${primary ? " ls-btn-primary" : ""}`, type: "button", text: label });
}

interface Chrome { root: HTMLElement; pane: HTMLElement; error: HTMLElement; cancel: HTMLButtonElement; apply: HTMLButtonElement; ok: HTMLButtonElement }

function renderChrome(isNew: boolean): Chrome {
  const title = isNew ? "New chart" : "Edit chart";
  const pane = renderElement("div", { class: "qmd-chart-editor-pane" });
  const cancel = button("Cancel");
  const apply = button("Apply");
  const ok = button("Ok", true);
  const error = renderElement("div", { class: "qmd-chart-editor-error", role: "alert" });
  error.hidden = true;
  const root = renderElement("div", { class: "ls-dialog ls-dialog-full qmd-chart-editor", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" },
    renderElement("div", { class: "qmd-chart-editor-head" }, renderElement("div", { class: "ls-dialog-title", text: title })),
    pane,
    renderElement("div", { class: "ls-dialog-actions qmd-chart-editor-actions" }, error, cancel, apply, ok),
  );
  return { root, pane, error, cancel, apply, ok };
}

/** What one open editor keeps between its handlers. */
interface Session {
  host: ChartEditorHost;
  chrome: Chrome;
  model: ChartModel | null;
  /** The table of a model whose data is in its CSV (`src`); null when it was not read. */
  table: ChartTable | null;
  dirty: boolean;
  closed: boolean;
  asking: boolean;
  committing: boolean;
  dataEditor: ReturnType<typeof mountDataEditor> | null;
  fnEditor: ReturnType<typeof mountFnEditor> | null;
  overlay: { close(): void } | null;
}

function teardown(s: Session): void {
  if (s.closed) return;
  s.closed = true;
  s.overlay?.close();
  s.dataEditor?.destroy();
  s.fnEditor?.destroy();
}

function discard(s: Session): void {
  teardown(s);
  s.host.done(null);
}

/** Asks before throwing changes away; the editor stays open when the answer is no. */
async function confirmDiscard(s: Session): Promise<void> {
  if (s.asking || s.closed) return;
  s.asking = true;
  try {
    if (await askDialog(DISCARD_TITLE, DISCARD_MESSAGE, "Discard", true)) discard(s);
  } finally {
    s.asking = false;
  }
}

/** Escape: leave an open field first, then ask before discarding changes; false lets the overlay close. */
function onEscape(s: Session): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== s.chrome.root && s.chrome.root.contains(active) && active.matches(FIELDS)) {
    s.chrome.root.focus();
    return true;
  }
  if (!s.dirty) return false;
  void confirmDiscard(s);
  return true;
}

/** The model to write: its table placed by commitChart (a large one written to its CSV first), unchanged when it has no table (a missing CSV, a function chart); null after showing a failed write. */
async function placeModel(s: Session, current: ChartModel, table: ChartTable | null): Promise<ChartModel | null> {
  if (table === null) return current;
  const placed = await commitChart(current, table, s.host.files);
  if (placed.model === null) {
    s.chrome.error.textContent = `Could not write the data file: ${placed.error}`;
    s.chrome.error.hidden = false;
    return null;
  }
  return placed.model;
}

/** Writes the CSV when the table leaves the block, then the model with its PNG; a failed write keeps the editor open with the error. Ok closes the editor afterwards. */
async function commit(s: Session, closeAfter: boolean): Promise<void> {
  const current = s.model;
  if (s.committing || s.closed || current === null) return;
  s.committing = true;
  const wasDirty = s.dirty;
  s.dirty = false;
  s.chrome.error.hidden = true;
  try {
    const table = current.data ?? s.table;
    const model = await placeModel(s, current, table);
    if (s.closed) return;
    if (model === null) { s.dirty = s.dirty || wasDirty; return; }
    if (model.src !== undefined && table !== null) s.table = table;
    const png = await takePng(s.host.loadPlotly, current, table);
    if (s.closed) return;
    s.host.done({ model, png });
    if (closeAfter) teardown(s);
  } finally {
    s.committing = false;
  }
}

/** Cancel / Apply / Ok, and the dirty mark that any field edit sets. */
function wireButtons(s: Session): void {
  const { chrome } = s;
  const markDirty = (): void => { s.dirty = true; };
  chrome.root.addEventListener("input", markDirty);
  chrome.root.addEventListener("change", markDirty);
  chrome.cancel.addEventListener("click", () => { if (s.dirty) void confirmDiscard(s); else discard(s); });
  chrome.apply.addEventListener("click", () => { void commit(s, false); });
  chrome.ok.addEventListener("click", () => { void commit(s, true); });
}

/** Shows the editor of the chart's kind: the data editor for a data chart, the function editor for a 2D or 3D function plot. */
function showModel(s: Session, current: ChartModel): void {
  if (current.kind === "data") {
    const editorRoot = renderElement("div", { class: "qmd-chart-editor-data" });
    s.chrome.pane.replaceChildren(editorRoot);
    const { files, missing } = s.host;
    s.dataEditor = mountDataEditor(editorRoot, { model: current, table: current.data ?? s.table ?? { cols: [] } }, (next) => {
      if (s.closed) return;
      s.model = next;
      s.dirty = true;
    }, s.host.loadPlotly, { ...(files ? { files } : {}), ...(current.src !== undefined && s.table === null && missing !== undefined ? { missing } : {}) });
    return;
  }
  if (current.kind === "fn2d" || current.kind === "fn3d") {
    const editorRoot = renderElement("div", { class: "qmd-chart-editor-fn" });
    s.chrome.pane.replaceChildren(editorRoot);
    s.fnEditor = mountFnEditor(editorRoot, current, (next) => {
      if (s.closed) return;
      s.model = next;
      s.dirty = true;
    }, s.host.loadPlotly, current.kind === "fn3d" ? 3 : 2);
    return;
  }
}

/** Fills the pane: the picker for a new chart (Apply and Ok wait for a choice), the chart's editor otherwise. */
function mountPane(s: Session): void {
  const { chrome } = s;
  if (s.model !== null) {
    showModel(s, s.model);
    chrome.ok.focus();
    return;
  }
  chrome.apply.disabled = true;
  chrome.ok.disabled = true;
  const picker = renderChartPicker((tile) => {
    if (s.closed || s.model !== null) return;
    const chosen = chartOfTile(tile);
    s.model = chosen;
    chrome.apply.disabled = false;
    chrome.ok.disabled = false;
    showModel(s, chosen);
    chrome.ok.focus();
  });
  chrome.pane.append(picker);
  picker.querySelector<HTMLElement>("button")?.focus();
}

/** Opens the editor over the page; `close()` removes it without writing. */
export function openChartEditor(host: ChartEditorHost): { close(): void } {
  const s: Session = {
    host,
    chrome: renderChrome(host.model === null),
    model: host.model,
    table: host.model?.src !== undefined ? host.table ?? null : null,
    dirty: false,
    closed: false,
    asking: false,
    committing: false,
    dataEditor: null,
    fnEditor: null,
    overlay: null,
  };
  wireButtons(s);
  s.overlay = mountOverlay(s.chrome.root, () => discard(s), { fullscreen: true, onEscape: () => onEscape(s) });
  mountPane(s);
  return { close: () => teardown(s) };
}
