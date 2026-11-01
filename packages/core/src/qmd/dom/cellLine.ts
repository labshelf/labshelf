// The one-line parts of a code cell: the quiet line under the code (language picker, Run with the last run's time, queue, Restart and the ⋯ menu button),
// the summary line of a collapsed cell (D8), and the output blocks after a cell that decide whether the cell has a result.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { showMenu } from "../../ui/dom/widgets/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { cellMenuEntries } from "./cellMenu.js";
import type { CellSummaryState } from "./cellSummary.js";
import { renderLanguagePicker, renderRestartButton, type CellControls } from "./inlineViews.js";
import type { NoteActions } from "./noteBar.js";
import { outputContent, readCellLabel } from "./outputView.js";
import { shortcutLabel } from "./qmdCommands.js";

/** What the cell line shows: `queue` is the queue mark (or null), `menu()` makes the ⋯ button, which shows only while the note is editable. */
export interface CellLineParts { controls: CellControls; editable: boolean; canRun: boolean; runTime: string; queue: HTMLElement | null; run(): void; menu(): HTMLButtonElement }

/** The ⋯ button at the end of the cell line, opening the cell menu (plan D10). */
export function renderCellMenuButton(view: EditorView, getPos: () => number | undefined, noteActions: NoteActions | undefined): HTMLButtonElement {
  const button = renderElement("button", { class: "qmd-cell-menu", type: "button", "aria-haspopup": "menu", "aria-label": "Cell actions", title: "Cell actions" }, "⋯");
  button.addEventListener("click", () => showMenu(button, cellMenuEntries(view, getPos, noteActions)));
  return button;
}

/** The children of the quiet line under the code: the language picker (or the fence language as text), Run with the last run's time, the queue mark, Restart and, in an editable note, the ⋯ cell menu. */
export function renderCellLine(parts: CellLineParts): Node[] {
  const sep = (): HTMLElement => renderElement("span", { class: "qmd-action-sep", "aria-hidden": "true" }, "·");
  const children: Node[] = [renderLanguagePicker(parts.controls, "qmd-cell-lang", parts.editable)];
  if (parts.canRun) {
    const run = renderElement("button", { class: "qmd-cell-run", type: "button", title: `Run (${shortcutLabel("Mod-Enter")}) · run and continue below (${shortcutLabel("Shift-Enter")})`, "aria-label": "Run cell" },
      "Run",
      renderElement("span", { class: "qmd-cell-run-icon", html: renderIcon("play"), "aria-hidden": "true" }),
      renderElement("span", { class: "qmd-cell-run-spinner", html: renderIcon("loader"), "aria-hidden": "true" }));
    run.addEventListener("click", () => parts.run());
    children.push(sep(), run);
    if (parts.runTime) children.push(renderElement("span", { class: "qmd-cell-time", title: "How long the last run took" }, parts.runTime));
  }
  if (parts.queue) children.push(sep(), parts.queue);
  const restart = renderRestartButton(parts.controls, "qmd-cell-run qmd-cell-restart");
  if (restart) children.push(sep(), restart);
  if (parts.editable) children.push(parts.menu());
  return children;
}

/** The summary element of a collapsed cell: it sits first in the cell, and a click or Enter / Space calls `onExpand`. */
function createCellSummary(onExpand: () => void): HTMLElement {
  const summary = renderElement("div", { class: "qmd-cell-summary", role: "button", tabindex: "0", contenteditable: "false", title: "Expand cell" });
  summary.addEventListener("click", onExpand);
  summary.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onExpand();
  });
  return summary;
}

/** The summary of a collapsed cell: its state (an out-of-date output turns it stale), a key that changes with what it shows, and its children: a glyph and text for an error or an out-of-date result (never colour alone), then '<Language> · <kind> · ran <when>'. */
function describeSummary(collapsed: { text: string; state: CellSummaryState }, outputs: readonly HTMLElement[]): { state: CellSummaryState; key: string; children(): Node[] } {
  const stale = outputs.some((dom) => dom.classList.contains("is-out-of-date")) ? "Out of date"
    : outputs.some((dom) => dom.classList.contains("is-maybe-stale")) ? "May be out of date" : null;
  const { text } = collapsed;
  const state: CellSummaryState = collapsed.state === "error" || stale === null ? collapsed.state : stale === "Out of date" ? "out-of-date" : "maybe-out-of-date";
  const children = (): Node[] => {
    const parts: Node[] = [renderElement("span", { class: "qmd-cell-summary-chevron", html: renderIcon("chevron-right"), "aria-hidden": "true" })];
    if (collapsed.state === "error") parts.push(renderElement("span", { class: "qmd-cell-summary-glyph is-error", html: renderIcon("x"), "aria-hidden": "true" }));
    parts.push(renderElement("span", { class: "qmd-cell-summary-text" }, text));
    if (stale) {
      parts.push(renderElement("span", { class: "qmd-cell-summary-stale" },
        renderElement("span", { class: "qmd-cell-summary-glyph is-stale", html: renderIcon("warning"), "aria-hidden": "true" }), ` ${stale}`));
    }
    return parts;
  };
  return { state, key: `${text}\u0000${state}\u0000${stale ?? ""}`, children };
}

/** The DOM of the output blocks after the cell `node` at `pos`. */
function cellOutputDoms(view: EditorView, node: ProseNode, pos: number | undefined): HTMLElement[] {
  if (pos === undefined || view.isDestroyed) return [];
  const doms: HTMLElement[] = [];
  const doc = view.state.doc;
  for (let at = pos + node.nodeSize, next = doc.resolve(at).nodeAfter; next?.type.name === "output"; at += next.nodeSize, next = doc.resolve(at).nodeAfter) {
    const dom = view.nodeDOM(at);
    if (dom instanceof HTMLElement) doms.push(dom);
  }
  return doms;
}

/** Whether the cell `node` at `pos` has a non-empty output right after it, or else one anywhere in the note that names its label. */
export function cellHasOutput(view: EditorView, node: ProseNode, pos: number | undefined): boolean {
  const label = readCellLabel(node.attrs.options as string);
  let hasOutput = false;
  let at = pos === undefined ? -1 : pos + node.nodeSize;
  for (let next = at < 0 ? null : view.state.doc.resolve(at).nodeAfter; next?.type.name === "output"; next = view.state.doc.resolve(at).nodeAfter) {
    if (outputContent(next.attrs.raw as string).trim()) hasOutput = true;
    at += next.nodeSize;
  }
  if (!hasOutput && label) view.state.doc.descendants((child) => { if (child.type.name === "output" && child.attrs.cell === label && outputContent(child.attrs.raw as string).trim()) { hasOutput = true; } });
  return hasOutput;
}

/** What the summary line needs of its cell: the cell's DOM and node, its position in the note, and how to expand it. */
export interface SummaryHost { readonly dom: HTMLElement; readonly view: EditorView; node(): ProseNode; pos(): number | undefined; expand(): void }

/**
 * The summary line of a cell: shown first in the cell while `watch` was last given a summary, and redrawn when an output's out-of-date class changes.
 * The outputs are watched once they are drawn (after the cell's view in the same update).
 */
export function createSummaryLine(host: SummaryHost): { watch(collapsed: { text: string; state: CellSummaryState } | null): void; destroy(): void } {
  let collapsed: { text: string; state: CellSummaryState } | null = null;
  let summary: HTMLElement | null = null;
  let summaryKey = "";
  const outputs = (): HTMLElement[] => cellOutputDoms(host.view, host.node(), host.pos());
  const render = (): void => {
    if (!collapsed) {
      summary?.remove();
      summary = null;
      summaryKey = "";
      return;
    }
    if (!summary) {
      summary = createCellSummary(() => host.expand());
      host.dom.prepend(summary);
      summaryKey = "";
    }
    const { state, key, children } = describeSummary(collapsed, outputs());
    if (key === summaryKey) return;
    summaryKey = key;
    summary.dataset.state = state;
    summary.replaceChildren(...children());
  };
  const observer = new MutationObserver(() => render());
  return {
    watch(next) {
      collapsed = next;
      observer.disconnect();
      render();
      if (!collapsed) return;
      queueMicrotask(() => {
        if (!collapsed || host.view.isDestroyed) return;
        observer.disconnect();
        for (const dom of outputs()) observer.observe(dom, { attributes: true, attributeFilter: ["class"] });
        render();
      });
    },
    destroy: () => observer.disconnect(),
  };
}
