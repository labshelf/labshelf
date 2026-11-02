// Shows the stored output of a code cell as text (a long one cut to its first lines with Show all), a plot or display math with its cell's quiet action line under the last one (or a param drag's preview result in its place),
// marking it out of date when its cell's code hashes to something other than the output's `source` or its param values changed, and under it the warnings of its cell's last run in this view.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement, showToast } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { plotContent, type CellResult, type CellRunInfo } from "../compute/index.js";
import { deriveCodeHash, findOutputs, isOutputParamsStale, readOutputImage, readOutputPlot } from "../item/index.js";
import { MaybeStaleCaption, stampRun } from "./cascadeStale.js";
import { cellControlsAt, renderLanguagePicker, renderRestartButton, type CellControls } from "./inlineViews.js";
import { loadCoreMath, renderMathInto, type MathLoader } from "./mathView.js";
import { openPlotFigure, openPlotImage, renderOutputPlot, type OutputPlot } from "./outputPlot.js";
import { loadCorePlotly, type PlotlyLoader } from "./plotView.js";

/** The value of the `#| label:` line in a cell's `options`, or "". */
export function readCellLabel(options: string): string {
  return /^#\|\s*label:\s*(.*?)\s*$/m.exec(options)?.[1] ?? "";
}

/** How long a run took, for the cell line: "0.4 s" under 10 s, "12 s" under a minute, then "2 min 5 s". */
export function formatRunTime(ms: number): string {
  if (ms < 50) return "< 0.1 s";
  if (ms < 9950) return `${Math.round(ms / 100) / 10} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return rest === 0 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 60)} min ${rest} s`;
}

/** The last run of each code cell made in this view, by the cell view's element; never stored, so a reopened note shows none. */
const cellRuns = new WeakMap<Node, CellRunInfo>();

/** Records the last run of the cell whose view element is `cellDom`; the cell view then notifies its outputs. */
export function noteCellRun(cellDom: HTMLElement, info: CellRunInfo): void {
  cellRuns.set(cellDom, info);
  stampRun(info);
}

/** The last run made in this view of the cell at `pos`, or undefined. */
function cellRunAt(view: EditorView, pos: number): CellRunInfo | undefined {
  const dom = view.isDestroyed ? null : view.nodeDOM(pos);
  return dom ? cellRuns.get(dom) : undefined;
}

/** The lines of an output block between its opening line and its closing `:::`. */
export function outputContent(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > 0 && lines.at(-1)?.trim() === ":::") lines.pop();
  return lines.slice(1).join("\n");
}

/** What a preview result shows in place of the stored output: its plot (the spec, with the PNG when it has one), its display math, its text, or its error. */
function previewContent(result: CellResult): string {
  return plotContent(result) ?? (result.latex ? `$$${result.latex}$$` : result.text ?? result.error ?? "");
}

/** A preview result without a spec drawn by itself, for a cell without a stored output: its display math, or its text or error in monospace. */
export function renderPreviewResult(result: CellResult, loadMath: MathLoader = loadCoreMath): HTMLElement {
  return renderOutputText(previewContent(result), loadMath);
}

const INSTALL_PREFIX = "Install it with: ";
const COPY_REFUSED_TEXT = "The clipboard refused the copy; select the command and copy it.";

/** One `div.qmd-output-install` with a copy button per line of the text that starts with `Install it with: `; the button copies the command after the prefix. */
export function renderInstallHints(text: string, copy: (text: string) => Promise<void> = (value) => navigator.clipboard.writeText(value)): HTMLElement[] {
  return text.split(/\r\n|\n|\r/).filter((line) => line.startsWith(INSTALL_PREFIX)).map((line) => {
    const command = line.slice(INSTALL_PREFIX.length).trimEnd();
    const button = renderElement("button", { class: "qmd-output-copy", type: "button", "aria-label": "Copy install command", title: "Copy install command", html: renderIcon("clipboard") });
    button.addEventListener("click", () => {
      const refused = () => { showToast(COPY_REFUSED_TEXT, "error"); };
      try { copy(command).then(() => { showToast(`Copied: ${command}`, "ok"); }, refused); } catch { refused(); }
    });
    return renderElement("div", { class: "qmd-output-install" }, button);
  });
}

const SHOWN_LINES = 30;
const SHOWN_CHARS = 3000;

/** The start a long text output shows until Show all: its first 30 lines, cut to 3000 characters; null for a text within both. */
function shownStart(text: string): string | null {
  const lines = text.split("\n");
  if (lines.length <= SHOWN_LINES && text.length <= SHOWN_CHARS) return null;
  return lines.slice(0, SHOWN_LINES).join("\n").slice(0, SHOWN_CHARS);
}

/** Output content that is not a plot: display math for one `$$ … $$` block, else its text in monospace without a wrapping fence, a long one cut with Show all (view only). */
function renderOutputText(content: string, loadMath: MathLoader): HTMLElement {
  const tex = displayMath(content);
  if (tex === null) {
    const text = plainOutput(content);
    const start = shownStart(text);
    const pre = renderElement("pre", { class: "qmd-output-text", text: start ?? text });
    const hints = renderInstallHints(text);
    if (start === null && hints.length === 0) return pre;
    const block = renderElement("div", { class: "qmd-output-text-block" }, pre);
    if (start !== null) {
      const more = renderElement("button", { class: "qmd-output-more", type: "button" }, `Show all (${text.split("\n").length} lines)`);
      more.addEventListener("click", () => { pre.textContent = text; more.remove(); });
      block.append(more);
    }
    block.append(...hints);
    return block;
  }
  const rendered = renderElement("div", { class: "qmd-math-rendered" });
  void renderMathInto(rendered, tex, true, loadMath);
  return renderElement("div", { class: "qmd-math qmd-math-display" }, rendered);
}

/** Removes a whole code fence from text results while preserving the stored Markdown. */
function plainOutput(text: string): string {
  const content = text.split("\n");
  const fence = /^(`{3,}|~{3,})[^\n]*$/.exec(content[0] ?? "")?.[1];
  const closing = content.at(-1)?.trim() ?? "";
  return fence && closing[0] === fence[0] && closing.length >= fence.length && [...closing].every((char) => char === fence[0])
    ? content.slice(1, -1).join("\n") : content.join("\n");
}

/** The TeX of an output that is one `$$ … $$` block, or null. */
function displayMath(content: string): string | null {
  return /^\s*\$\$([\s\S]*?)\$\$\s*$/.exec(content)?.[1]?.trim() ?? null;
}

/** The pointer events that ProseMirror turns into a node selection of a clicked output. */
const POINTER_EVENTS: ReadonlySet<string> = new Set(["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "touchstart", "touchend"]);

class OutputView implements NodeView {
  readonly dom: HTMLElement;
  private readonly body: HTMLElement;
  /** What the body shows: the stored output (`raw`) or a preview's content, keyed so an unchanged one is not redrawn. */
  private shownKey: string | null = null;
  private checkedKey: string | null = null;
  private readonly observer: MutationObserver;
  private destroyed = false;
  private caption: HTMLElement | null = null;
  /** The weaker caption for a cell above that changed since this ran (D7). */
  private readonly maybe: MaybeStaleCaption;
  private preview: (() => void) | null = null;
  private plot: OutputPlot | null = null;
  private actions: HTMLElement | null = null;
  private actionsKey: string | null = null;
  /** The warnings band of the cell's last run in this view, and the run it shows. */
  private warnings: HTMLElement | null = null;
  private warningsRun: CellRunInfo | undefined;
  private controls: CellControls | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Set once the editor has drawn its nodes, so this view can look up its cell's view. */
  private ready = false;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly loadMath: MathLoader, private readonly loadPlotly: PlotlyLoader) {
    this.body = renderElement("div", { class: "qmd-output-body" });
    // Draggable as a whole, so a drag moves the output with its cell (blockDragPlugin) instead of copying the image out.
    this.dom = renderElement("div", { class: "qmd-output", contenteditable: "false", draggable: "true" }, this.body);
    // An unchanged output keeps its view when only its cell changes, so the view watches the editor for edits.
    this.maybe = new MaybeStaleCaption(view, this.dom, () => ({ cellPos: this.cellPos(), ran: this.node.attrs.ran as string | null, run: this.ready ? this.lastRun() : undefined }), readCellLabel);
    this.observer = new MutationObserver(() => { this.checkSource(); this.renderActions(); });
    this.observer.observe(view.dom, { childList: true, subtree: true, characterData: true });
    this.render();
    // Drawn with the editor's first document: its cell folds at once, so the note does not show the code first.
    if (view.isDestroyed) this.cell()?.refresh(true);
    queueMicrotask(() => { this.ready = true; this.cell()?.refresh(); this.render(); });
  }

  /** Follows the controls of this output's cell, so a drag preview and the run state reach every output of it. */
  private connect(): void {
    if (this.destroyed || !this.ready || this.view.isDestroyed) return;
    const controls = this.cell();
    if (controls === this.controls) return;
    this.unsubscribe?.();
    this.controls = controls;
    this.unsubscribe = controls?.subscribe(() => this.render()) ?? null;
  }

  /** Shows the stored output, or while its cell's params are dragged the preview result in the last output, the others hidden. */
  private render(): void {
    if (this.destroyed) return;
    this.connect();
    const raw = this.node.attrs.raw as string;
    const result = this.controls?.previewResult();
    const last = result === undefined || this.isLast();
    const preview = result !== undefined && last ? previewContent(result) : null;
    this.body.hidden = !last;
    this.dom.classList.toggle("is-preview", preview !== null);
    const key = preview === null ? `raw\u0000${raw}` : `preview\u0000${preview}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      const content = preview ?? outputContent(raw);
      const plot = readOutputPlot(content);
      if (this.plot && !this.plot.failed && plot) {
        this.plot.update(plot);
      } else {
        this.preview?.();
        this.preview = null;
        this.plot?.destroy();
        this.plot = null;
        this.renderContent(content, plot);
      }
    }
    this.checkSource();
    this.maybe.update();
    this.renderWarnings();
    this.renderActions();
  }

  /** The last run in this view of this output's cell, or undefined. */
  private lastRun(): CellRunInfo | undefined {
    const pos = this.cellPos();
    return pos === null ? undefined : cellRunAt(this.view, pos);
  }

  /** Under the body of the last output: a collapsed band naming how many warnings the cell's last run in this view gave, opening to list them; none without warnings. */
  private renderWarnings(): void {
    const run = this.ready && this.isLast() ? this.lastRun() : undefined;
    if (run === this.warningsRun) return;
    this.warningsRun = run;
    this.warnings?.remove();
    this.warnings = null;
    const list = run?.warnings ?? [];
    if (list.length === 0) return;
    const count = list.length === 1 ? "1 warning" : `${list.length} warnings`;
    const summary = renderElement("summary", { class: "qmd-output-warnings-summary" },
      renderElement("span", { class: "qmd-output-warnings-icon", html: renderIcon("warning"), "aria-hidden": "true" }),
      renderElement("span", { class: "qmd-output-warnings-count" }, count));
    const items = renderElement("ul", { class: "qmd-output-warnings-list" }, ...list.map((warning) => renderElement("li", { class: "qmd-output-warnings-item" }, warning)));
    this.warnings = renderElement("details", { class: "qmd-output-warnings" }, summary, items);
    this.body.after(this.warnings);
  }

  /** Replaces the body with the stored plot, an image, or the output's text or display math. */
  private renderContent(content: string, plot: ReturnType<typeof readOutputPlot>): void {
    const image = plot?.image ?? readOutputImage(content);
    this.dom.classList.toggle("qmd-output-figure", plot !== null || image !== null);
    this.dom.classList.toggle("qmd-output-interactive", plot !== null);
    if (!plot && !image) {
      this.body.replaceChildren(renderOutputText(content, this.loadMath));
      return;
    }
    const expand = renderElement("button", { class: "qmd-output-expand", type: "button", "aria-label": "Expand plot", title: "Expand plot", html: renderIcon("external") });
    if (plot) {
      const key = this.node.attrs.cell as string;
      const shown = renderOutputPlot(this.body, plot, expand, this.loadPlotly, key);
      this.plot = shown;
      expand.addEventListener("click", () => { this.preview?.(); this.preview = openPlotFigure(shown.spec, shown.label, this.loadPlotly, key); });
    } else if (image) {
      expand.addEventListener("click", () => { this.preview?.(); this.preview = openPlotImage(image.src, image.alt); });
      this.body.replaceChildren(renderElement("img", { class: "qmd-output-image", src: image.src, alt: image.alt, draggable: "false" }), expand);
    }
  }

  /** The controls of this output's cell, or null when it has none. */
  private cell(): CellControls | null {
    const pos = this.cellPos();
    return pos === null ? null : cellControlsAt(this.view, pos);
  }

  /** Whether no output of the same cell follows this one. */
  private isLast(): boolean {
    const pos = this.getPos();
    return pos === undefined || this.view.state.doc.resolve(pos + this.node.nodeSize).nodeAfter?.type.name !== "output";
  }

  /** Under the last output of a cell with a result: the language picker, Run again, Restart and Show or Hide code; redrawn only when one of them changes. */
  private renderActions(): void {
    if (this.destroyed || !this.ready || this.view.isDestroyed) return;
    this.connect();
    const controls = this.isLast() ? this.controls : null;
    const show = controls?.hasResult() === true;
    this.dom.classList.toggle("is-running", show && controls.isRunning());
    const ms = show ? this.lastRun()?.durationMs : undefined;
    const time = ms === undefined ? "" : formatRunTime(ms);
    const key = show ? [controls.language(), controls.canRun(), controls.canRestart(), controls.isOpen(), this.view.editable, time].join("\u0000") : null;
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    this.actions?.remove();
    this.actions = null;
    if (!show) return;
    const sep = (): HTMLElement => renderElement("span", { class: "qmd-action-sep", "aria-hidden": "true" }, "·");
    // The cell's own line is hidden once it has a result, so the picker and Restart live here too.
    const line = renderElement("div", { class: "qmd-output-actions" }, renderLanguagePicker(controls, "qmd-output-lang", this.view.editable));
    if (controls.canRun()) {
      const run = renderElement("button", { class: "qmd-output-action qmd-output-run", type: "button", "aria-label": "Run again" }, "Run again",
        renderElement("span", { class: "qmd-output-run-icon", html: renderIcon("refresh"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-output-run-spinner", html: renderIcon("loader"), "aria-hidden": "true" }));
      run.addEventListener("click", () => controls.run());
      line.append(sep(), run);
      if (time) line.append(renderElement("span", { class: "qmd-cell-time", title: "How long the last run took" }, time));
    }
    const restart = renderRestartButton(controls, "qmd-output-action qmd-output-restart");
    if (restart) line.append(sep(), restart);
    const open = controls.isOpen();
    const code = renderElement("button", { class: "qmd-output-action qmd-output-code", type: "button", "aria-expanded": String(open) }, open ? "Hide code" : "Show code");
    code.addEventListener("click", () => controls.setOpen(!controls.isOpen()));
    line.append(sep(), code);
    this.actions = line;
    this.dom.append(line);
  }

  /** The position of the cell this output belongs to, as `cellNode` finds it. */
  private cellPos(): number | null {
    const pos = this.getPos();
    if (pos === undefined) return null;
    const wanted = this.node.attrs.cell as string;
    let found: number | null = null;
    this.view.state.doc.nodesBetween(0, pos, (child, childPos) => {
      if (childPos >= pos) return false;
      if (child.type.name !== "code_cell") return true;
      if (!wanted || readCellLabel(child.attrs.options as string) === wanted) found = childPos;
      return false;
    });
    return found;
  }

  /** The cell this output belongs to: the nearest earlier `code_cell` labelled `cell`, or the nearest earlier cell when the output names none. */
  private cellNode(): ProseNode | null {
    const pos = this.cellPos();
    return pos === null ? null : this.view.state.doc.nodeAt(pos);
  }

  /** Out of date when the cell's code hashes to something other than `source`, or its param values differ from the output's `params`. */
  private checkSource(): void {
    if (this.destroyed) return;
    const cell = this.cellNode();
    const code = cell?.attrs.code as string | undefined;
    const options = (cell?.attrs.options as string | undefined) ?? "";
    const raw = this.node.attrs.raw as string;
    const source = this.node.attrs.source as string;
    const key = code === undefined ? null : `${source}\u0000${code}\u0000${options}\u0000${raw}`;
    if (key === this.checkedKey) return;
    this.checkedKey = key;
    if (code === undefined) {
      this.showStale(null);
      return;
    }
    const paramsStale = isOutputParamsStale(findOutputs(raw)[0]?.params, options);
    void deriveCodeHash(code).then((hash) => {
      if (this.destroyed || this.checkedKey !== key) return;
      this.showStale(hash !== source ? "code" : paramsStale ? "params" : null);
    }, () => undefined);
  }

  /** The caption exists only while the output is out of date, so a current output carries no trace of the state; its words carry the state, and what changed, without colour. */
  private showStale(changed: "code" | "params" | null): void {
    this.dom.classList.toggle("is-out-of-date", changed !== null);
    this.maybe.setOwn(changed !== null);
    this.caption?.remove();
    this.caption = null;
    if (changed === null) return;
    const what = changed === "code" ? "the code changed" : "the parameters changed";
    this.caption = renderElement("div", { class: "qmd-output-caption", role: "note" },
      renderElement("span", { class: "qmd-output-caption-icon", html: renderIcon("warning"), "aria-hidden": "true" }),
      renderElement("span", { class: "qmd-output-caption-text" }, `Out of date — ${what} since this ran`));
    this.dom.prepend(this.caption);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  /**
   * The action line, Show all, the warnings band, the expand button and the plot handle their own events; a press or click anywhere on a plot or image output (or
   * its action line) never turns into a node selection. A drag from anywhere still moves the output, and the keyboard still selects it.
   */
  stopEvent(event: Event): boolean {
    if (event.type === "dragstart") return false;
    const target = event.target as Element | null;
    if (target?.closest?.(".qmd-output-actions button, .qmd-output-expand, .qmd-output-more, .qmd-output-warnings-summary, .qmd-plot-tools, .qmd-output-plot") != null) return true;
    return POINTER_EVENTS.has(event.type) && (this.dom.classList.contains("qmd-output-figure") || target?.closest?.(".qmd-output-actions, .qmd-output-caption, .qmd-output-warnings") != null);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe?.();
    this.controls?.refresh();
    this.preview?.();
    this.plot?.destroy();
    this.plot = null;
    this.observer.disconnect();
    this.maybe.destroy();
  }
}

/** A node view for `output`: text in monospace, a `$$ … $$` output as display math, its cell's action line under the last output, and `is-out-of-date` when its cell's code hash differs from `source`. */
export function createOutputView(loadMath?: () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>, loadPlotly?: PlotlyLoader): NodeViewConstructor {
  const loader = loadMath ?? loadCoreMath;
  const plotly = loadPlotly ?? loadCorePlotly;
  return (node, view, getPos) => new OutputView(node, view, getPos, loader, plotly);
}

