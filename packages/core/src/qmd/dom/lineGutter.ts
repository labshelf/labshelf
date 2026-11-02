// The line gutter of a note editor: a number beside the first line of each top-level block, a '+' on the hovered line that opens the insert menu after
// that block, and a click on a number that moves the caret to the block. Numbers continue across the editors of one notes file through a LineNumbering.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { qmdSchema } from "../editor/index.js";
import { showGapMenu } from "./insertGap.js";
import { revealBlockIn } from "./noteOutline.js";

/** One numbered line: the block at `pos`, and `end`, the gap after it and the outputs that belong to it (where '+' inserts). */
export interface GutterLine { pos: number; end: number }

/** The numbered lines of `doc`: every top-level block but a cell's outputs, which share their cell's line. */
export function gutterLines(doc: ProseNode): GutterLine[] {
  const lines: GutterLine[] = [];
  doc.forEach((node, offset) => {
    const end = offset + node.nodeSize;
    const last = lines.at(-1);
    if (node.type === qmdSchema.nodes.output && last) last.end = end;
    else lines.push({ pos: offset, end });
  });
  return lines;
}

/** A gutter's place in a shared numbering: the number before its first line, a call after its line count changed, and leaving. */
interface LineNumberingSeat { start(): number; changed(): void; leave(): void }

/** Shares one continuous numbering between the gutters of several editors, in the order they join. */
export interface LineNumbering { join(count: () => number, renumber: () => void): LineNumberingSeat }

export function createLineNumbering(): LineNumbering {
  const members: { count: () => number; renumber: () => void }[] = [];
  const renumberFrom = (index: number): void => { for (const member of members.slice(index)) member.renumber(); };
  return {
    join(count, renumber) {
      const self = { count, renumber };
      members.push(self);
      return {
        start() {
          let total = 0;
          for (const member of members) { if (member === self) break; total += member.count(); }
          return total;
        },
        changed() { renumberFrom(members.indexOf(self) + 1); },
        leave() {
          const index = members.indexOf(self);
          if (index < 0) return;
          members.splice(index, 1);
          renumberFrom(index);
        },
      };
    },
  };
}

export interface LineGutterOptions { editable: boolean; numbering?: LineNumbering }
/** `update(docChanged)` follows a transaction: a doc change renumbers the lines, any change places them again. */
export interface LineGutter { update(docChanged: boolean): void; destroy(): void }

/** The px value of a computed `line-height`, or undefined when it is not in px ('normal'). */
const pxOf = (value: string): number | undefined => (value.endsWith("px") ? Number.parseFloat(value) : undefined);

/** Mounts the gutter as the first child of the editor's `root`, beside `view`. */
export function mountLineGutter(root: HTMLElement, view: EditorView, options: LineGutterOptions): LineGutter {
  const gutter = renderElement("div", { class: "qmd-gutter", "aria-hidden": "true" });
  root.prepend(gutter);
  root.classList.add("has-gutter");
  let lines: GutterLine[] = [];
  let rows: HTMLElement[] = [];
  let tops: number[] = [];
  let frame: number | undefined;
  const seat = options.numbering?.join(() => lines.length, () => renumber());

  const renumber = (): void => {
    const start = seat?.start() ?? 0;
    rows.forEach((row, index) => { row.querySelector(".qmd-gutter-number")!.textContent = String(start + index + 1); });
  };

  const renderRow = (index: number): HTMLElement => {
    const number = renderElement("button", { class: "qmd-gutter-number", type: "button", tabindex: "-1", title: "Go to this line" });
    number.addEventListener("mousedown", (event) => event.preventDefault());
    number.addEventListener("click", () => { const line = lines[index]; if (line) revealBlockIn(view, line.pos); });
    const row = renderElement("div", { class: "qmd-gutter-line" });
    if (options.editable) {
      const add = renderElement("button", { class: "qmd-gutter-add", type: "button", tabindex: "-1", "aria-haspopup": "menu", "aria-label": "Insert below", title: "Insert below", html: renderIcon("plus") });
      add.addEventListener("mousedown", (event) => event.preventDefault());
      add.addEventListener("click", () => {
        const line = lines[index];
        if (!line) return;
        const doc = view.state.doc;
        showGapMenu(view, add, () => (view.state.doc === doc ? line.end : undefined));
      });
      row.append(add);
    }
    row.append(number);
    return row;
  };

  /** Places each row at the top of its block's first line; a block that does not show (folded away) hides its row. Without layout (jsdom, a hidden host) rows keep their order only. */
  const layout = (): void => {
    frame = undefined;
    if (view.isDestroyed || view.dom.getClientRects().length === 0) return;
    const origin = gutter.getBoundingClientRect().top;
    tops = lines.map((line, index) => {
      const row = rows[index]!;
      const dom = view.nodeDOM(line.pos);
      if (!(dom instanceof HTMLElement) || dom.getClientRects().length === 0) { row.hidden = true; return Number.NaN; }
      row.hidden = false;
      const rect = dom.getBoundingClientRect();
      const top = rect.top - origin;
      row.style.top = `${top}px`;
      row.style.height = `${Math.min(rect.height, pxOf(getComputedStyle(dom).lineHeight) ?? rect.height)}px`;
      return top;
    });
  };
  const schedule = (): void => {
    if (frame !== undefined) return;
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(layout);
    else layout();
  };

  const render = (): void => {
    const before = lines.length;
    lines = gutterLines(view.state.doc);
    while (rows.length < lines.length) rows.push(gutter.appendChild(renderRow(rows.length)));
    for (const row of rows.splice(lines.length)) row.remove();
    renumber();
    if (lines.length !== before) seat?.changed();
    schedule();
  };

  // The '+' of the line under the pointer shows while the pointer is anywhere on that line, not only over the gutter.
  let hovered: HTMLElement | undefined;
  const hover = (row: HTMLElement | undefined): void => {
    if (row === hovered) return;
    hovered?.classList.remove("is-hover");
    row?.classList.add("is-hover");
    hovered = row;
  };
  const onMove = (event: MouseEvent): void => {
    const y = event.clientY - gutter.getBoundingClientRect().top;
    let found: HTMLElement | undefined;
    tops.forEach((top, index) => { if (top <= y) found = rows[index]; });
    hover(found);
  };
  const onLeave = (): void => hover(undefined);
  root.addEventListener("mousemove", onMove);
  root.addEventListener("mouseleave", onLeave);

  // A width change rewraps the text and a late render (math, an image, a plot) changes a block's height: both move the lines. A hidden host (width 0) waits.
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => { if (entries.some((entry) => entry.contentRect.width > 0)) schedule(); }) : undefined;
  resize?.observe(view.dom);

  render();
  return {
    update(docChanged) { if (docChanged) render(); else schedule(); },
    destroy() {
      resize?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      seat?.leave();
      gutter.remove();
      root.classList.remove("has-gutter");
    },
  };
}
