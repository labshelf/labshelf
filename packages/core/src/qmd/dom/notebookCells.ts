// The code cells of one editor as notebook cells a run coordinator drives (keys, section keys, run to the end state, queue marks),
// and the per-cell side of it that the code cell view keeps: the queue mark on its line and the run whose end state it awaits.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import type { CellRunEnd, NotebookCell } from "../noteRuns.js";
import { CELL_CANCEL_EVENT, CELL_END_EVENT } from "./cellRunStatus.js";
import { cellControlsAt, fenceCellLanguage, isNoteCell, type CellControls } from "./inlineViews.js";
import { readCellLabel } from "./outputView.js";

/** A cell's place in a run of several cells: waiting its turn, or skipped because a cell above failed. */
type CellQueueState = "queued" | "not-run" | null;

/** A heading's section: its key, level and text, in document order. */
export interface NoteSection { readonly key: string; readonly level: number; readonly text: string }

/** The view-state key of a heading's section (plan D9): the `occurrence`-th (from 0) heading with this level and text. */
export function sectionKey(level: number, text: string, occurrence: number): string {
  return `${level}:${text}:${occurrence}`;
}

/** A code cell of a document: its item-local key (its label, else `cell-<n>` among all code cells), place, siblings' parent and the sections that contain it. */
export interface DocCell { readonly key: string; readonly pos: number; readonly node: ProseNode; readonly parent: ProseNode | null; readonly index: number; readonly sectionKeys: readonly string[] }

/** A heading of a document with its section key (occurrences of a level and text counted over every heading). */
export interface DocHeading extends NoteSection { readonly pos: number; readonly node: ProseNode }

/** Walks the document once, in document order: every heading with its section key and every code cell with its key and the sections that contain it. */
export function scanDoc(doc: ProseNode): { cells: DocCell[]; headings: DocHeading[] } {
  const cells: DocCell[] = [];
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();
  let open: NoteSection[] = [];
  doc.descendants((node, pos, parent, index) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent;
      const occurrence = seen.get(`${level}:${text}`) ?? 0;
      seen.set(`${level}:${text}`, occurrence + 1);
      const section = { key: sectionKey(level, text, occurrence), level, text };
      open = [...open.filter((outer) => outer.level < level), section];
      headings.push({ ...section, pos, node });
      return false;
    }
    if (node.type.name !== "code_cell") return !node.isTextblock;
    if (!isNoteCell(node)) return false;
    const label = readCellLabel(node.attrs.options as string);
    cells.push({ key: label || `cell-${cells.length + 1}`, pos, node, parent, index, sectionKeys: open.map((section) => section.key) });
    return false;
  });
  return { cells, headings };
}

function scan(doc: ProseNode, itemId: string): { cells: (DocCell & { readonly itemKey: string })[]; sections: NoteSection[] } {
  const { cells, headings } = scanDoc(doc);
  return {
    cells: cells.map((cell) => ({ ...cell, itemKey: `${itemId}#${cell.key}` })),
    sections: headings.map(({ key, level, text }) => ({ key, level, text })),
  };
}

/** The headings of the editor's document as sections, in document order. */
export function noteSections(view: EditorView): readonly NoteSection[] {
  return scan(view.state.doc, "").sections;
}

/**
 * The code cells of the editor's document in document order, as notebook cells of item `itemId`. Each cell finds its view again by
 * key when called, so a cell listed before outputs were added still reaches its view; a cell gone since, or in a read-only view, resolves 'missing' from run().
 */
export function notebookCells(view: EditorView, itemId: string): readonly NotebookCell[] {
  const controls = (key: string): CellControls | null => {
    if (view.isDestroyed) return null;
    const entry = scan(view.state.doc, itemId).cells.find((cell) => cell.itemKey === key);
    return entry ? cellControlsAt(view, entry.pos) : null;
  };
  return scan(view.state.doc, itemId).cells.map(({ itemKey: key, node, sectionKeys }) => ({
    key,
    itemId,
    language: fenceCellLanguage(node.attrs.lang as string | null) ?? (node.attrs.lang as string | null) ?? "",
    sectionKeys,
    run: () => (view.isDestroyed || view.editable === false ? null : controls(key)?.runToEnd()) ?? Promise.resolve<CellRunEnd>("missing"),
    cancel: () => controls(key)?.cancel(),
    setQueue: (state) => controls(key)?.setQueue(state),
  }));
}

/** The notebook side of one code cell view. */
export interface CellRuns {
  queue(): CellQueueState;
  setQueue(state: CellQueueState): void;
  /** The cell's code changed: a Not run or Queued mark goes. */
  edited(): void;
  /**
   * Marks the cell `is-run-requested` (the run status row shows its run in it), clears its queue mark and calls `send`; resolves at
   * the end state the row posts to the cell, or 'missing' at once when `send` returns false because the row refused the run.
   */
  run(send: () => unknown): Promise<CellRunEnd>;
  /** Asks the run status row to cancel this cell's run, when it is the one in flight. */
  cancel(): void;
  /** The queue mark for the cell line, or null without one. */
  renderQueue(): HTMLElement | null;
  /** The view goes away: a run still awaited resolves 'missing'. */
  destroy(): void;
}

/** @returns the notebook side of the code cell view whose element is `dom` inside the editor element `root`; `changed` redraws its line. */
export function createCellRuns(dom: HTMLElement, root: () => HTMLElement, changed: () => void): CellRuns {
  let queue: CellQueueState = null;
  let waiting: ((end: CellRunEnd) => void)[] = [];
  const end = (state: CellRunEnd): void => { const all = waiting; waiting = []; for (const resolve of all) resolve(state); };
  const onEnd = (event: Event): void => end((event as CustomEvent<CellRunEnd>).detail);
  dom.addEventListener(CELL_END_EVENT, onEnd);
  const setQueue = (state: CellQueueState): void => {
    if (state === queue) return;
    queue = state;
    dom.classList.toggle("is-queued", state === "queued");
    dom.classList.toggle("is-not-run", state === "not-run");
    changed();
  };
  return {
    queue: () => queue,
    setQueue,
    edited: () => setQueue(null),
    run(send) {
      setQueue(null);
      const before = Array.from(root().querySelectorAll(".qmd-cell.is-run-requested"));
      for (const cell of before) cell.classList.remove("is-run-requested");
      dom.classList.add("is-run-requested");
      const done = new Promise<CellRunEnd>((resolve) => waiting.push(resolve));
      if (send() !== false) return done;
      // The row ignores a run while another is in flight: the mark goes back to the cell whose run that is.
      waiting.pop();
      dom.classList.remove("is-run-requested");
      for (const cell of before) cell.classList.add("is-run-requested");
      return Promise.resolve("missing");
    },
    cancel: () => { if (dom.classList.contains("is-run-requested")) dom.dispatchEvent(new CustomEvent(CELL_CANCEL_EVENT, { bubbles: true })); },
    renderQueue() {
      if (queue === "queued") return renderElement("span", { class: "qmd-cell-queue", title: "Waits its turn in the run" },
        renderElement("span", { class: "qmd-cell-queue-icon", html: renderIcon("history"), "aria-hidden": "true" }), "Queued");
      if (queue === "not-run") return renderElement("span", { class: "qmd-cell-queue qmd-cell-not-run" }, "Not run: stopped at an error above");
      return null;
    },
    destroy() { dom.removeEventListener(CELL_END_EVENT, onEnd); end("missing"); },
  };
}
