// The slide grid of a compiled talk: every slide as a thumbnail of its first page, reordered by drag or Alt+arrows, with a per-slide menu
// (Duplicate, Delete, Arrange); a double-click or Enter opens the slide. Slides are named by their index in the deck tree.
import { renderElement, renderIcon, showMenu } from "../../../../ui/dom/index.js";
import { SLIDE_ARRANGEMENTS, describeSourceDeckNode, type SlideArrangement, type SourceDeckNode, type SourceDeckPath } from "../../../index.js";
import type { PdfDeck } from "../../pdfDeck.js";

const THUMB_WIDTH = 240;

export interface SlideGridHooks {
  select(slide: number): void;
  /** Selects the slide and opens it in Visual. */
  open(slide: number): void;
  /** Moves slide `from` to where slide `to` is now (both tree indexes of slides). */
  move(from: number, to: number): void;
  duplicate(slide: number): void;
  remove(slide: number): void;
  arrange(slide: number, arrangement: SlideArrangement): void;
  /** The first page a slide shows, 1-based; undefined before a build. */
  pageOfSlide(slide: number): number | undefined;
}

export interface SlideGrid {
  element: HTMLElement;
  render(tree: readonly SourceDeckNode[], selected: SourceDeckPath): void;
  /** Draws the thumbnails from a newly opened PDF. */
  setPdf(pdf: PdfDeck | undefined): void;
}

/** Draws 1-based `page` of the PDF into the canvas at `width` CSS pixels, sharp on dense screens. */
export async function drawPdfPage(pdf: PdfDeck, canvas: HTMLCanvasElement, page: number, width: number): Promise<void> {
  const size = pdf.pageSize(page - 1);
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  await pdf.render(canvas, page - 1, (width / size.width) * ratio).catch(() => undefined);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${(size.height / size.width) * width}px`;
}

/** What one grid keeps between renders. */
interface GridState {
  hooks: SlideGridHooks;
  list: HTMLElement;
  pdf: PdfDeck | undefined;
  /** The tree indexes of the slides, in order. */
  slides: number[];
  thumbs: Map<number, HTMLCanvasElement>;
  dragFrom: number;
}

function thumbOf(gs: GridState, slide: number): HTMLCanvasElement {
  let canvas = gs.thumbs.get(slide);
  if (!canvas) { canvas = renderElement("canvas", { class: "dsh-grid-canvas" }); gs.thumbs.set(slide, canvas); }
  return canvas;
}

/** The slide whose place a drop takes: before or after the target by the pointer's half, counted in the order without the dragged slide. */
function dropTarget(gs: GridState, from: number, target: number, after: boolean): number | undefined {
  const order = gs.slides;
  const fromAt = order.indexOf(from); const targetAt = order.indexOf(target);
  if (fromAt < 0 || targetAt < 0) return undefined;
  const to = after ? targetAt + (fromAt < targetAt ? 0 : 1) : targetAt - (fromAt < targetAt ? 1 : 0);
  return to === fromAt ? undefined : order[to];
}

function bindDrag(gs: GridState, cell: HTMLElement, slide: number): void {
  const clear = (): void => { cell.classList.remove("is-drop-before", "is-drop-after"); };
  const isAfter = (event: MouseEvent): boolean => { const box = cell.getBoundingClientRect(); return event.clientX >= box.left + box.width / 2; };
  cell.addEventListener("dragstart", (event) => {
    gs.dragFrom = slide;
    const transfer = (event as DragEvent).dataTransfer;
    if (transfer) { transfer.effectAllowed = "move"; transfer.setData("text/plain", String(slide + 1)); }
  });
  cell.addEventListener("dragover", (event) => {
    if (gs.dragFrom < 0) return;
    event.preventDefault();
    const after = isAfter(event);
    cell.classList.toggle("is-drop-after", after);
    cell.classList.toggle("is-drop-before", !after);
  });
  cell.addEventListener("dragleave", clear);
  cell.addEventListener("drop", (event) => {
    event.preventDefault();
    clear();
    const from = gs.dragFrom;
    gs.dragFrom = -1;
    if (from < 0) return;
    const to = dropTarget(gs, from, slide, isAfter(event));
    if (to !== undefined) gs.hooks.move(from, to);
  });
  cell.addEventListener("dragend", () => { gs.dragFrom = -1; for (const other of gs.list.children) other.classList.remove("is-drop-before", "is-drop-after"); });
}

function onCellKey(gs: GridState, event: KeyboardEvent, slide: number): void {
  const at = gs.slides.indexOf(slide);
  if (event.key === "Enter" && !event.altKey) { event.preventDefault(); gs.hooks.open(slide); return; }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const neighbour = gs.slides[at + (event.key === "ArrowRight" ? 1 : -1)];
  event.preventDefault();
  if (neighbour === undefined) return;
  if (event.altKey) gs.hooks.move(slide, neighbour); else gs.hooks.select(neighbour);
}

function actionsMenu(gs: GridState, button: HTMLElement, slide: number): void {
  showMenu(button, [
    { label: "Duplicate", icon: "copy", onSelect: () => gs.hooks.duplicate(slide) },
    { label: "Delete", icon: "trash", danger: true, onSelect: () => gs.hooks.remove(slide) },
    "separator",
    { label: "Arrange", icon: "grid", onSelect: () => showMenu(button, SLIDE_ARRANGEMENTS.map((choice) => ({ label: choice.label, onSelect: () => gs.hooks.arrange(slide, choice.id) }))) },
  ]);
}

function createCell(gs: GridState, node: SourceDeckNode, slide: number, position: number, selected: boolean): HTMLElement {
  const title = describeSourceDeckNode(node, slide);
  const page = gs.hooks.pageOfSlide(slide);
  const option = renderElement("button", { type: "button", class: "dsh-grid-option", role: "option", "aria-selected": String(selected), "data-slide": String(slide), title, tabindex: selected ? "0" : "-1" },
    renderElement("span", { class: "dsh-grid-frame", "data-empty": String(page === undefined) }, thumbOf(gs, slide)),
    renderElement("span", { class: "dsh-grid-caption" },
      renderElement("span", { class: "dsh-grid-number", text: String(position + 1) }), renderElement("span", { class: "dsh-grid-title", text: title })));
  option.addEventListener("click", () => gs.hooks.select(slide));
  option.addEventListener("dblclick", () => gs.hooks.open(slide));
  option.addEventListener("keydown", (event) => onCellKey(gs, event, slide));
  const actions = renderElement("button", { type: "button", class: "dsh-grid-actions", title: "Slide actions", "aria-label": "Slide actions", html: renderIcon("more") });
  actions.addEventListener("click", () => actionsMenu(gs, actions, slide));
  const cell = renderElement("div", { class: "dsh-grid-cell", role: "presentation", draggable: "true" }, option, actions);
  bindDrag(gs, cell, slide);
  return cell;
}

async function drawThumbs(gs: GridState, current: PdfDeck): Promise<void> {
  for (const slide of gs.slides) {
    if (gs.pdf !== current) return;
    const page = gs.hooks.pageOfSlide(slide);
    if (page !== undefined) await drawPdfPage(current, thumbOf(gs, slide), page, THUMB_WIDTH);
  }
}

export function createSlideGrid(hooks: SlideGridHooks): SlideGrid {
  const list = renderElement("div", { class: "dsh-grid-list", role: "listbox", "aria-label": "Slide grid", "aria-orientation": "horizontal" });
  const element = renderElement("section", { class: "dsh-grid", "aria-label": "Slides" }, list);
  const gs: GridState = { hooks, list, pdf: undefined, slides: [], thumbs: new Map(), dragFrom: -1 };
  let tree: readonly SourceDeckNode[] = [];
  let selected: SourceDeckPath = [];

  /** The same tree again only moves the selection, so a cell under the pointer or the focus stays the same element. */
  const markSelected = (): void => {
    for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const on = option.dataset["slide"] === String(selected[0]);
      option.setAttribute("aria-selected", String(on));
      option.tabIndex = on ? 0 : -1;
    }
  };
  const render = (): void => {
    const hadFocus = list.contains(element.ownerDocument.activeElement);
    gs.slides = tree.flatMap((node, index) => (node.kind === "slide" ? [index] : []));
    const known = new Set(gs.slides);
    for (const slide of gs.thumbs.keys()) if (!known.has(slide)) gs.thumbs.delete(slide);
    list.replaceChildren(...gs.slides.map((slide, position) => createCell(gs, tree[slide]!, slide, position, selected[0] === slide)));
    const current = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (hadFocus) current?.focus({ preventScroll: true });
    current?.scrollIntoView?.({ block: "nearest" });
  };

  return {
    element,
    render(nextTree, nextSelected) {
      const same = nextTree === tree && list.childElementCount > 0;
      tree = nextTree; selected = nextSelected;
      if (same) markSelected(); else render();
    },
    setPdf(next) {
      gs.pdf = next;
      if (!next) return;
      render();
      void drawThumbs(gs, next);
    },
  };
}
