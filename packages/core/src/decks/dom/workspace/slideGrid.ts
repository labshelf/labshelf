// The slide grid of a compiled talk: every slide as a thumbnail of its first page, reordered by drag or Alt+arrows, with a per-slide menu
// (Duplicate, Delete, Arrange); a double-click or Enter opens the slide. Slides are named by their index in the deck tree.
import { acceptsFileDrop, readFileDrop, renderElement, renderIcon, showMenu, type FileDrop } from "../../../ui/dom/index.js";
import { SLIDE_ARRANGEMENTS, describeSourceDeckNode, type SlideArrangement, type SourceDeckNode, type SourceDeckPath } from "../../index.js";
import type { PdfDeck } from "../pdfDeck.js";
import type { PageSection } from "./linking.js";

/** The px width a cell's page is drawn at: sharp at half a wide window, where the two columns put it. */
const THUMB_WIDTH = 480;

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
  /** Whether the last build marks the slide's content as overflowing it; absent, no slide is marked. */
  overflowOfSlide?(slide: number): boolean;
  /** Files dropped on a slide's cell (a project file or a uri list); absent, the cells take no file drops. */
  dropImage?(slide: number, drop: FileDrop): void;
  /** The slides and the section dividers between them, in page order. */
  units(): StripUnit[];
  selectSection(section: PageSection): void;
}

export interface SlideGrid {
  element: HTMLElement;
  render(tree: readonly SourceDeckNode[], selected: SourceDeckPath): void;
  /** Draws the thumbnails from a newly opened PDF, and the overflow badges again. */
  setPdf(pdf: PdfDeck | undefined): void;
}

/** A section divider page the build shipped, as the strip and the grid list it among the slides: its first page and the command's title. */
export interface SectionUnit { kind: "section"; section: PageSection; page: number; title: string; selected: boolean }
/** What the strip and the grid list, in page order: a slide by tree index, or a section divider. */
export type StripUnit = { kind: "slide"; index: number } | SectionUnit;

/** The key a section divider's cached thumbnail is kept by. */
export const sectionKey = (section: PageSection): string => `${section.file ?? ""}:${section.line}`;

/**
 * A section divider's card in the strip (`prefix` dw-thumb) or the grid (dsh-grid): its page in `canvas`, a Section mark and its title.
 * A click selects it; it has no menu and is not dragged.
 */
export function sectionCard(unit: SectionUnit, canvas: HTMLCanvasElement, prefix: "dw-thumb" | "dsh-grid", select: (section: PageSection) => void): HTMLElement {
  const card = renderElement("button", {
    type: "button", class: `${prefix === "dsh-grid" ? "dsh-grid-option" : "dw-thumb"} dw-section-card`, role: prefix === "dsh-grid" ? "option" : "treeitem",
    "aria-selected": String(unit.selected), "data-section": sectionKey(unit.section), title: unit.title,
  }, renderElement("span", { class: `${prefix}-frame` }, canvas), renderElement("span", { class: `${prefix}-title` },
    renderElement("span", { class: "dw-section-mark", text: "Section" }), document.createTextNode(` ${unit.title}`)));
  card.addEventListener("click", () => select(unit.section));
  return card;
}

/** The Overflow pill a slide's grid cell or structure thumbnail shows when its content does not fit the slide. */
export function overflowBadge(): HTMLElement {
  return renderElement("span", { class: "dsh-overflow-badge", title: "Content overflows this slide", text: "Overflow" });
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
  /** Each cell's page, by slide index or section key. */
  thumbs: Map<string, HTMLCanvasElement>;
  dragFrom: number;
}

function thumbOf(gs: GridState, key: string): HTMLCanvasElement {
  let canvas = gs.thumbs.get(key);
  if (!canvas) { canvas = renderElement("canvas", { class: "dsh-grid-canvas" }); gs.thumbs.set(key, canvas); }
  return canvas;
}

/** A cell's thumbnail key and page: a slide's first page, or a section divider's. */
const thumbKey = (unit: StripUnit): string => (unit.kind === "slide" ? String(unit.index) : `s:${sectionKey(unit.section)}`);

/** The slide whose place a drop takes: before or after the target by the pointer's half, counted in the order without the dragged slide. */
function dropTarget(gs: GridState, from: number, target: number, after: boolean): number | undefined {
  const order = gs.slides;
  const fromAt = order.indexOf(from); const targetAt = order.indexOf(target);
  if (fromAt < 0 || targetAt < 0) return undefined;
  const to = after ? targetAt + (fromAt < targetAt ? 0 : 1) : targetAt - (fromAt < targetAt ? 1 : 0);
  return to === fromAt ? undefined : order[to];
}

/** A drag from outside the grid that carries files the grid's dropImage hook takes. */
const takesFiles = (gs: GridState, event: DragEvent): boolean => gs.dragFrom < 0 && gs.hooks.dropImage !== undefined && acceptsFileDrop(event.dataTransfer?.types);

function bindDrag(gs: GridState, cell: HTMLElement, slide: number): void {
  const clear = (): void => { cell.classList.remove("is-drop-before", "is-drop-after", "is-drop-target"); };
  const isAfter = (event: MouseEvent): boolean => { const box = cell.getBoundingClientRect(); return event.clientX >= box.left + box.width / 2; };
  cell.addEventListener("dragstart", (event) => {
    gs.dragFrom = slide;
    const transfer = (event as DragEvent).dataTransfer;
    if (transfer) { transfer.effectAllowed = "move"; transfer.setData("text/plain", String(slide + 1)); }
  });
  cell.addEventListener("dragover", (event) => {
    if (takesFiles(gs, event)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      cell.classList.add("is-drop-target");
      return;
    }
    if (gs.dragFrom < 0) return;
    event.preventDefault();
    const after = isAfter(event);
    cell.classList.toggle("is-drop-after", after);
    cell.classList.toggle("is-drop-before", !after);
  });
  cell.addEventListener("dragleave", clear);
  cell.addEventListener("drop", (event) => {
    clear();
    if (takesFiles(gs, event)) { event.preventDefault(); gs.hooks.dropImage!(slide, readFileDrop(event.dataTransfer)); return; }
    event.preventDefault();
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
    renderElement("span", { class: "dsh-grid-frame", "data-empty": String(page === undefined) }, thumbOf(gs, String(slide))),
    renderElement("span", { class: "dsh-grid-caption" },
      renderElement("span", { class: "dsh-grid-number", text: String(position + 1) }), renderElement("span", { class: "dsh-grid-title", text: title }),
      ...(gs.hooks.overflowOfSlide?.(slide) ? [overflowBadge()] : [])));
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
  for (const unit of gs.hooks.units()) {
    if (gs.pdf !== current) return;
    const page = unit.kind === "slide" ? gs.hooks.pageOfSlide(unit.index) : unit.page;
    if (page !== undefined) await drawPdfPage(current, thumbOf(gs, thumbKey(unit)), page, THUMB_WIDTH);
  }
}

export function createSlideGrid(hooks: SlideGridHooks): SlideGrid {
  const list = renderElement("div", { class: "dsh-grid-list", role: "listbox", "aria-label": "Slide grid", "aria-orientation": "horizontal" });
  const element = renderElement("section", { class: "dw-slide-grid", "aria-label": "Slides" }, list);
  const gs: GridState = { hooks, list, pdf: undefined, slides: [], thumbs: new Map(), dragFrom: -1 };
  let tree: readonly SourceDeckNode[] = [];
  let selected: SourceDeckPath = [];

  /** The same tree again only moves the selection, so a cell under the pointer or the focus stays the same element. */
  const markSelected = (): void => {
    const section = hooks.units().find((unit): unit is SectionUnit => unit.kind === "section" && unit.selected);
    for (const option of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const on = section ? option.dataset["section"] === sectionKey(section.section) : option.dataset["slide"] === String(selected[0]);
      option.setAttribute("aria-selected", String(on));
      option.tabIndex = on ? 0 : -1;
    }
  };
  const render = (): void => {
    const hadFocus = list.contains(element.ownerDocument.activeElement);
    const units = hooks.units();
    gs.slides = units.flatMap((unit) => (unit.kind === "slide" ? [unit.index] : []));
    const known = new Set(units.map(thumbKey));
    for (const key of gs.thumbs.keys()) if (!known.has(key)) gs.thumbs.delete(key);
    const anySection = units.some((unit) => unit.kind === "section" && unit.selected);
    list.replaceChildren(...units.map((unit) => (unit.kind === "section"
      ? renderElement("div", { class: "dsh-grid-cell", role: "presentation" }, sectionCard(unit, thumbOf(gs, thumbKey(unit)), "dsh-grid", hooks.selectSection))
      : createCell(gs, tree[unit.index]!, unit.index, gs.slides.indexOf(unit.index), !anySection && selected[0] === unit.index))));
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
