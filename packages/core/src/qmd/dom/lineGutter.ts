// The line gutter of a note editor, after VS Code's: a number at the first line of every block (a taller block leaves blank gutter below it) and, in the
// last editor, empty numbered lines after the last block down to the bottom of the visible area (at least MIN_TRAILING_LINES); shown while the pointer is over the gutter, with a '+' on the line under the
// pointer that opens the insert menu there and the collapse chevrons of cells and sections. Numbers continue across the editors of one notes file
// through a LineNumbering.
import type { Node as ProseNode } from "prosemirror-model";
import { Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { qmdSchema } from "../editor/index.js";
import { foldStateOf, setFold } from "./foldPlugin.js";
import { showGapMenu } from "./insertGap.js";
import { scanDoc } from "./notebookCells.js";
import { revealBlockIn } from "./noteOutline.js";

/** One numbered block: the block at `pos`, and `end`, the gap after it and the outputs that belong to it (where '+' inserts). */
export interface GutterLine { pos: number; end: number }

/** The numbered blocks of `doc`: every top-level block but a cell's outputs, which share their cell's line. */
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

/** A gutter's place in a shared numbering: the number before its first line, the total of all gutters, whether it is the last one, a call after its line count changed, and leaving. */
interface LineNumberingSeat { start(): number; total(): number; isLast(): boolean; changed(): void; leave(): void }

/** Shares one continuous numbering between the gutters of several editors, in the order they join. */
export interface LineNumbering { join(count: () => number, renumber: () => void): LineNumberingSeat }

export function createLineNumbering(): LineNumbering {
  const members: { count: () => number; renumber: () => void }[] = [];
  // Every other gutter is told: the later ones shift, all of them widen their column when the total gains a digit, and the last one gains the trailing lines.
  const renumberBut = (self: unknown): void => { for (const member of members) if (member !== self) member.renumber(); };
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
        total: () => members.reduce((sum, member) => sum + member.count(), 0),
        isLast: () => members.at(-1) === self,
        changed() { renumberBut(self); },
        leave() {
          const index = members.indexOf(self);
          if (index < 0) return;
          members.splice(index, 1);
          renumberBut(self);
        },
      };
    },
  };
}

export interface LineGutterOptions { editable: boolean; numbering?: LineNumbering }
/** `update(docChanged)` follows a transaction: a doc change renumbers the blocks, any change marks the caret's line and places the lines again. */
export interface LineGutter { update(docChanged: boolean): void; destroy(): void }

/** A collapsible block: a cell or a section heading, by its fold key. */
interface Fold { kind: "cell" | "section"; key: string; collapsed: boolean }
/** One gutter line: a block's first line (`block`), or an empty line after the last block; `at` is the gap its '+' inserts into. */
interface Entry { block?: number; at: number; top?: number; bottom?: number; fold?: Fold }
interface Row { el: HTMLElement; number: HTMLElement; fold?: HTMLButtonElement }

/** The fewest empty numbered lines after the last block of the last editor, where '+' inserts at the end; a short note gets more, down to the bottom of the view. */
const MIN_TRAILING_LINES = 5;
/** The editor line height when no style gives one in px. */
const DEFAULT_LINE_PX = 20;
/** The px value of a computed `line-height`, or undefined when it is not in px ('normal'). */
const pxOf = (value: string): number | undefined => (value.endsWith("px") ? Number.parseFloat(value) : undefined);

function foldsOf(view: EditorView): Map<number, Fold> {
  const state = foldStateOf(view.state);
  const { cells, headings } = scanDoc(view.state.doc);
  const folds = new Map<number, Fold>();
  for (const cell of cells) folds.set(cell.pos, { kind: "cell", key: cell.key, collapsed: state.cells.has(cell.key) });
  for (const heading of headings) folds.set(heading.pos, { kind: "section", key: heading.key, collapsed: state.sections.has(heading.key) });
  return folds;
}

/**
 * The gutter lines of `view`. Without layout (jsdom, a hidden host) one line per block. With layout, every block that shows takes a line of `lineHeight`
 * centred on its first text line, and `trailing` empty lines follow the last block; a folded-away block takes none.
 */
function entriesOf(view: EditorView, gutter: HTMLElement, lineHeight: number, trailing: number): Entry[] {
  const { doc } = view.state;
  const folds = foldsOf(view);
  const blocks = gutterLines(doc);
  const withFold = (entry: Entry, pos: number): Entry => { const fold = folds.get(pos); return fold ? { ...entry, fold } : entry; };
  if (view.dom.getClientRects().length === 0) return blocks.map((line) => withFold({ block: line.pos, at: line.end }, line.pos));
  const box = gutter.getBoundingClientRect();
  const entries: Entry[] = [];
  let cursor = 0;
  for (const line of blocks) {
    const dom = view.nodeDOM(line.pos);
    if (!(dom instanceof HTMLElement) || dom.getClientRects().length === 0) continue;
    const rect = dom.getBoundingClientRect();
    const top = rect.top - box.top;
    // Centred on the block's first text line, never above the line before it.
    const first = Math.min(pxOf(getComputedStyle(dom).lineHeight) ?? lineHeight, rect.height || lineHeight);
    const lineTop = Math.max(cursor, top + (first - lineHeight) / 2);
    const bottom = Math.max(rect.bottom - box.top, lineTop + lineHeight);
    entries.push(withFold({ block: line.pos, at: line.end, top: lineTop, bottom }, line.pos));
    cursor = bottom;
  }
  for (let i = 0; i < trailing; i++, cursor += lineHeight) {
    entries.push({ at: doc.content.size, top: cursor, bottom: cursor + lineHeight });
  }
  return entries;
}

/** The element that scrolls `el` (the nearest ancestor that scrolls vertically, else the document). */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Room, in px, kept below the empty lines for what follows the editor (the card's padding and border, the page margin). */
const TRAILING_TAIL_PX = 24;

/** How many empty lines fill the view below the note without adding scroll, given the `padding` (px) they take now; at least MIN_TRAILING_LINES. */
function trailingCount(view: EditorView, lineHeight: number, padding: number): number {
  const scroller = scrollerOf(view.dom);
  const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
  // The editor's bottom without the empty lines, in the scroller's content coordinates, so the count does not follow the scroll position.
  const origin = isPage ? 0 : scroller.getBoundingClientRect().top;
  const bottom = view.dom.getBoundingClientRect().bottom - origin + scroller.scrollTop - padding;
  const visible = isPage ? window.innerHeight : scroller.clientHeight;
  return Math.max(MIN_TRAILING_LINES, Math.floor((visible - bottom - TRAILING_TAIL_PX) / lineHeight));
}

/** Marks the line of the block that holds the caret (a cell's line also holds its outputs). */
function markActive(view: EditorView, entries: Entry[], rows: Row[]): void {
  const from = view.state.selection.from;
  let active = -1;
  entries.forEach((entry, index) => { if (entry.block !== undefined && entry.block <= from) active = index; });
  rows.forEach((row, index) => row.el.classList.toggle("is-active", index === active));
}

function navigate(view: EditorView, entry: Entry): void {
  if (entry.block !== undefined) { revealBlockIn(view, entry.block); return; }
  const { doc } = view.state;
  view.dispatch(view.state.tr.setSelection(Selection.near(doc.resolve(Math.min(entry.at, doc.content.size)), -1)));
  view.focus();
}

/** One gutter line: the number, and in an editable note the fold chevron and the '+'. `entryAt` reads the entry the line shows now. */
function renderRow(view: EditorView, editable: boolean | undefined, entryAt: (index: number) => Entry | undefined, index: number): Row {
  const number = renderElement("span", { class: "qmd-gutter-number" });
  number.addEventListener("mousedown", (event) => event.preventDefault());
  number.addEventListener("click", () => { const entry = entryAt(index); if (entry) navigate(view, entry); });
  const el = renderElement("div", { class: "qmd-gutter-line" }, number);
  if (!editable) return { el, number };
  const add = renderElement("button", { class: "qmd-gutter-add", type: "button", tabindex: "-1", "aria-haspopup": "menu", "aria-label": "Insert here", title: "Insert here", html: renderIcon("plus") });
  add.addEventListener("mousedown", (event) => event.preventDefault());
  add.addEventListener("click", () => {
    const entry = entryAt(index);
    if (!entry) return;
    const { doc } = view.state;
    showGapMenu(view, add, () => (view.state.doc === doc ? entry.at : undefined));
  });
  const fold = renderElement("button", { class: "qmd-gutter-fold", type: "button", tabindex: "-1" });
  fold.addEventListener("mousedown", (event) => event.preventDefault());
  fold.addEventListener("click", () => {
    const target = entryAt(index)?.fold;
    if (target) setFold(view, target.kind === "cell" ? { cell: [target.key, !target.collapsed] } : { section: [target.key, !target.collapsed] });
  });
  el.append(fold, add);
  return { el, number, fold };
}

/** Grows or shrinks `rows` to `count` lines, appending the new ones to the gutter; returns how many there were before. */
function fitRows(gutter: HTMLElement, rows: Row[], count: number, make: (index: number) => Row): number {
  const before = rows.length;
  while (rows.length < count) rows.push(make(rows.length));
  for (const row of rows.splice(count)) row.el.remove();
  gutter.append(...rows.slice(before).map((row) => row.el));
  return before;
}

/** Puts a row at its entry's place and shows its fold state. */
function placeRow(row: Row, entry: Entry, height: number): void {
  if (entry.top !== undefined) { row.el.style.top = `${entry.top}px`; row.el.style.height = `${height}px`; }
  row.el.classList.toggle("is-collapsed", entry.fold?.collapsed === true);
  if (!row.fold) return;
  row.fold.hidden = !entry.fold;
  row.fold.innerHTML = entry.fold ? renderIcon(entry.fold.collapsed ? "chevron-right" : "chevron-down") : "";
  const label = entry.fold?.collapsed ? "Expand" : "Collapse";
  row.fold.title = label;
  row.fold.setAttribute("aria-label", label);
}

/** The last editor keeps room for its empty lines below the last block, down to the bottom of the view; returns how many lines it keeps. */
function reserveTrailing(view: EditorView, height: number, trailing: boolean): number {
  if (!trailing) { view.dom.style.removeProperty("padding-bottom"); return 0; }
  const count = view.dom.getClientRects().length === 0 ? MIN_TRAILING_LINES : trailingCount(view, height, Number.parseFloat(view.dom.style.paddingBottom) || 0);
  view.dom.style.paddingBottom = `${count * height}px`;
  return count;
}

/** Only the gutter is the hover zone: its numbers show while the pointer is over it (CSS), and the '+' of the gutter line under the pointer. */
function trackHover(gutter: HTMLElement, entries: () => Entry[], rows: Row[]): void {
  let hovered: HTMLElement | undefined;
  const hover = (row: HTMLElement | undefined): void => {
    if (row === hovered) return;
    hovered?.classList.remove("is-hover");
    row?.classList.add("is-hover");
    hovered = row;
  };
  gutter.addEventListener("mousemove", (event) => {
    const y = event.clientY - gutter.getBoundingClientRect().top;
    const index = entries().findIndex((entry) => entry.top !== undefined && entry.top <= y && y < (entry.bottom ?? entry.top));
    hover(rows[index]?.el);
  });
  gutter.addEventListener("mouseleave", () => hover(undefined));
}

/** Writes the line numbers (continuing from the notes before this one) and sizes the number column to the digits of the total. */
function numberRows(gutter: HTMLElement, rows: Row[], seat: LineNumberingSeat | undefined, count: number): void {
  const start = seat?.start() ?? 0;
  rows.forEach((row, index) => { row.number.textContent = String(start + index + 1); });
  gutter.style.setProperty("--qmd-gutter-digits", String(Math.max(2, String(seat?.total() ?? count).length)));
}

/** Calls `schedule` when the layout may change; returns the function that stops watching. */
function watchLayout(view: EditorView, root: HTMLElement, schedule: () => void): () => void {
  // A width change rewraps the text, a late render (math, an image, a plot) changes a block's height and the root's height sets the trailing lines. A hidden host (width 0) waits.
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver((observed) => { if (observed.some((entry) => entry.contentRect.width > 0)) schedule(); }) : undefined;
  resize?.observe(view.dom);
  resize?.observe(root);
  // A taller window has room for more empty lines.
  window.addEventListener("resize", schedule);
  return () => { resize?.disconnect(); window.removeEventListener("resize", schedule); };
}

/** Puts a new gutter element first in `root`. */
function mountGutter(root: HTMLElement): HTMLElement {
  const gutter = renderElement("div", { class: "qmd-gutter", "aria-hidden": "true" });
  root.prepend(gutter);
  root.classList.add("has-gutter");
  return gutter;
}

/** Takes the gutter out of `root` and undoes the room it made in `root` and `view`. */
function unmountGutter(root: HTMLElement, view: EditorView, gutter: HTMLElement): void {
  gutter.remove();
  root.classList.remove("has-gutter", "has-gutter-trailing");
  root.style.removeProperty("padding-left");
  view.dom.style.removeProperty("padding-bottom");
}

/** Mounts the gutter as the first child of the editor's `root`, beside `view`. */
export function mountLineGutter(root: HTMLElement, view: EditorView, options: LineGutterOptions): LineGutter {
  const gutter = mountGutter(root);
  let entries: Entry[] = [];
  const rows: Row[] = [];
  let frame: number | undefined;
  const seat = options.numbering?.join(() => entries.length, () => { renumber(); schedule(); });
  const trailing = (): boolean => seat?.isLast() ?? true;
  const lineHeight = (): number => pxOf(getComputedStyle(gutter).lineHeight) ?? pxOf(getComputedStyle(view.dom).lineHeight) ?? DEFAULT_LINE_PX;
  const renumber = (): void => numberRows(gutter, rows, seat, entries.length);
  const draw = (height: number): void => {
    const before = fitRows(gutter, rows, entries.length, (index) => renderRow(view, options.editable, (at) => entries[at], index));
    entries.forEach((entry, index) => placeRow(rows[index]!, entry, height));
    renumber();
    markActive(view, entries, rows);
    if (rows.length !== before) seat?.changed();
  };
  const refresh = (): void => {
    frame = undefined;
    if (view.isDestroyed) return;
    const height = lineHeight();
    root.classList.toggle("has-gutter-trailing", trailing());
    entries = entriesOf(view, gutter, height, reserveTrailing(view, height, trailing()));
    draw(height);
    // The content starts right of the gutter, whose width follows the digits in the editor font.
    if (gutter.offsetWidth > 0) root.style.paddingLeft = `${gutter.offsetWidth}px`;
  };
  const schedule = (): void => {
    if (frame !== undefined) return;
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(refresh);
    else refresh();
  };
  trackHover(gutter, () => entries, rows);
  const unwatch = watchLayout(view, root, schedule);
  refresh();
  return {
    update(docChanged) {
      if (docChanged) refresh();
      else { markActive(view, entries, rows); schedule(); }
    },
    destroy() {
      unwatch();
      if (frame !== undefined) cancelAnimationFrame(frame);
      seat?.leave();
      unmountGutter(root, view, gutter);
    },
  };
}
