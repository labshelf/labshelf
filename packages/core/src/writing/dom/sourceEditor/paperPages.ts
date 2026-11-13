// A paper's pages for a popup: scrollable, drawn near the viewport, with a pdf.js text layer to select from, the paper's
// highlights and note pins, and what the person selects or clicks; plus a page thumbnail for hovers.
import { drawPdfPage, openPdfDeck, type PdfDeck, type PdfDeckSource } from "../../../decks/dom/pdfDeck.js";
import type { Annotation, AnnotationPosition } from "../../../model/index.js";
import type { ItemFile } from "../../../qmd/item/index.js";
import { deriveBoxInPage, derivePageFrame } from "../../../reader/dom/pageHighlights.js";
import { renderElement, renderIcon } from "../../../ui/dom/index.js";
import { deriveNotePage } from "../../citations/citeTargets.js";

/** How a host gives a paper's PDF: the shape openPdfDeck takes. */
export type PaperPdfSource = PdfDeckSource;

/** A note shown as a pin: its 1-based page and, when the note has a place, its point in page fractions (pins without one stack at the page's right edge). */
export interface PaperNotePin { id: string; page: number; x?: number; y?: number }

/** The pins of the notes that have a page: a point or box at its place, a note on a highlight at the highlight's corner, others at the page's edge. */
export function deriveNotePins(notes: ItemFile | undefined, annotations: readonly Annotation[]): PaperNotePin[] {
  return (notes?.segments ?? []).flatMap((segment): PaperNotePin[] => {
    if (segment.kind !== "item") return [];
    const page = deriveNotePage(segment, annotations);
    if (page === undefined) return [];
    const { anchor } = segment;
    if (anchor.kind === "point" || anchor.kind === "box") return [{ id: segment.id, page, x: anchor.x, y: anchor.y }];
    const position = anchor.kind === "highlight" ? annotations.find((annotation) => annotation.id === anchor.annotationId)?.position : undefined;
    return [position ? { id: segment.id, page, x: position.x, y: position.y } : { id: segment.id, page }];
  });
}

/** A selection of the paper's text: the 1-based page it starts on, its text, and the highlight it lies inside, if any. */
export interface PaperSelection { page: number; text: string; highlightId?: string }

/** A highlight's id and box in page fractions. */
export interface PaperHighlightBox { id: string; position: AnnotationPosition }

interface PaperPagesOptions {
  source: PaperPdfSource;
  /** The paper's annotations; highlights with a position are drawn. */
  annotations: readonly Annotation[];
  notes: readonly PaperNotePin[];
  onSelection(selection: PaperSelection): void;
  onHighlightClick(id: string): void;
  onNoteClick(id: string): void;
  /** The 1-based page that shows the most, each time it changes. */
  onPageInView(page: number): void;
}

interface PaperPagesView {
  element: HTMLElement;
  /** The page count once the PDF is open; rejects when it cannot be opened. */
  ready: Promise<number>;
  destroy(): void;
}

/** One page's box, its highlights and the layers drawn while it is near the viewport. */
interface PageSlot { page: number; box: HTMLElement; marks: HTMLElement; highlights: PaperHighlightBox[]; layers: HTMLElement[]; width: number }

interface ViewState {
  options: PaperPagesOptions;
  scroller: HTMLElement;
  deck: PdfDeck | undefined;
  slots: PageSlot[];
  visible: Map<number, number>;
  inView: number;
  destroyed: boolean;
  observers: Array<{ disconnect(): void }>;
}

const MAX_SELECTION = 2000;
// Text-layer rectangles overhang the highlight drawn from them by a little.
const TOLERANCE = 0.005;
const PIN_STACK = 0.05;

/** The smallest highlight that holds the centre of every box, or undefined; a click is a zero-size box. */
export function findHighlightAt(boxes: readonly AnnotationPosition[], highlights: readonly PaperHighlightBox[]): string | undefined {
  if (boxes.length === 0) return undefined;
  const holds = ({ position: p }: PaperHighlightBox, box: AnnotationPosition): boolean => {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return x >= p.x - TOLERANCE && x <= p.x + p.width + TOLERANCE && y >= p.y - TOLERANCE && y <= p.y + p.height + TOLERANCE;
  };
  const area = ({ position }: PaperHighlightBox): number => position.width * position.height;
  return highlights.filter((highlight) => boxes.every((box) => holds(highlight, box))).sort((a, b) => area(a) - area(b))[0]?.id;
}

/** What a selection reports: its page, its text with whitespace collapsed and capped, and the highlight its boxes lie inside; undefined without text. */
export function derivePaperSelection(page: number, text: string, boxes: readonly AnnotationPosition[], highlights: readonly PaperHighlightBox[]): PaperSelection | undefined {
  const flat = text.replace(/\s+/g, " ").trim().slice(0, MAX_SELECTION);
  if (!flat) return undefined;
  const highlightId = findHighlightAt(boxes, highlights);
  return { page, text: flat, ...(highlightId ? { highlightId } : {}) };
}

/** Draws 1-based `page` of the PDF on a new canvas `width` CSS pixels wide; the PDF is opened for it and closed after. */
export async function renderPageThumbnail(source: PaperPdfSource, page: number, width: number): Promise<HTMLCanvasElement> {
  const deck = await openPdfDeck(source);
  try {
    const canvas = renderElement("canvas", { class: "ls-paper-thumb" });
    await drawPdfPage(deck, canvas, Math.min(Math.max(page, 1), deck.count), width);
    return canvas;
  } finally {
    deck.destroy();
  }
}

/** Mounts the paper's pages in `container`; pages draw when they come near the viewport and are dropped when they leave it. */
export function mountPaperPages(container: HTMLElement, options: PaperPagesOptions): PaperPagesView {
  const scroller = renderElement("div", { class: "ls-paper-pages" });
  container.append(scroller);
  const st: ViewState = { options, scroller, deck: undefined, slots: [], visible: new Map(), inView: 0, destroyed: false, observers: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The selection settles after the pointer is released.
  scroller.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!st.destroyed) readPointer(st, event); }, 0);
  });
  const ready = openPdfDeck(options.source).then((deck) => {
    if (st.destroyed) {
      deck.destroy();
      return 0;
    }
    st.deck = deck;
    buildSlots(st, deck);
    observe(st);
    return deck.count;
  });
  return {
    element: scroller,
    ready,
    destroy: () => {
      st.destroyed = true;
      clearTimeout(timer);
      for (const observer of st.observers) observer.disconnect();
      st.deck?.destroy();
      scroller.remove();
    },
  };
}

function buildSlots(st: ViewState, deck: PdfDeck): void {
  const highlights = st.options.annotations.filter((annotation) => annotation.type === "highlight" && annotation.position);
  for (let page = 1; page <= deck.count; page++) {
    const size = deck.pageSize(page - 1);
    const marks = renderElement("div", { class: "ls-paper-marks" });
    const pins = renderElement("div", { class: "ls-paper-pins" });
    const box = renderElement("div", { class: "ls-paper-page", "data-page": String(page) }, marks, pins);
    box.style.aspectRatio = `${size.width} / ${size.height}`;
    const onPage = highlights.filter((annotation) => annotation.pageNumber === page);
    for (const annotation of onPage) marks.append(highlightMark(annotation));
    st.options.notes.filter((note) => note.page === page).forEach((note, index) => pins.append(notePin(st, note, index)));
    st.slots.push({ page, box, marks, highlights: onPage.map(({ id, position }) => ({ id, position: position! })), layers: [], width: 0 });
    st.scroller.append(box);
  }
}

/** Positioned in percent of the page, so it keeps its place at any width. */
function placeAt(element: HTMLElement, box: AnnotationPosition): void {
  element.style.left = `${box.x * 100}%`;
  element.style.top = `${box.y * 100}%`;
  element.style.width = `${box.width * 100}%`;
  element.style.height = `${box.height * 100}%`;
}

function highlightMark(annotation: Annotation): HTMLElement {
  const mark = renderElement("div", { class: `ls-paper-hl${annotation.style === "underline" ? " ls-paper-hl-underline" : ""}` });
  mark.style.setProperty("--ls-paper-hl-color", `var(--ls-hl-${annotation.color ?? "note"})`);
  placeAt(mark, annotation.position!);
  return mark;
}

function notePin(st: ViewState, note: PaperNotePin, index: number): HTMLElement {
  const placed = note.x !== undefined && note.y !== undefined;
  const pin = renderElement("button", { type: "button", class: `ls-paper-pin${placed ? "" : " ls-paper-pin-edge"}`, title: "Note", "aria-label": "Note", html: renderIcon("message") });
  pin.style.left = `${(placed ? note.x! : 1) * 100}%`;
  pin.style.top = `${(placed ? note.y! : index * PIN_STACK) * 100}%`;
  pin.addEventListener("click", (event) => {
    event.stopPropagation();
    st.options.onNoteClick(note.id);
  });
  // Keeps a click on a pin from reading as a click on the page beneath.
  pin.addEventListener("pointerup", (event) => event.stopPropagation());
  return pin;
}

function observe(st: ViewState): void {
  const slotOf = (element: Element): PageSlot | undefined => st.slots[Number((element as HTMLElement).dataset["page"]) - 1];
  const near = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = slotOf(entry.target);
      if (!slot) continue;
      if (entry.isIntersecting) drawSlot(st, slot);
      else clearSlot(slot);
    }
  }, { root: st.scroller, rootMargin: "100% 0px" });
  const shown = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = slotOf(entry.target);
      if (slot) st.visible.set(slot.page, entry.isIntersecting ? entry.intersectionRect.height : 0);
    }
    notifyInView(st);
  }, { root: st.scroller, threshold: [0, 0.25, 0.5, 0.75, 1] });
  // A new width redraws the drawn pages, so the canvas stays sharp and the text layer lines up.
  const resize = new ResizeObserver(() => { for (const slot of st.slots) if (slot.layers.length > 0) drawSlot(st, slot); });
  for (const slot of st.slots) {
    near.observe(slot.box);
    shown.observe(slot.box);
  }
  resize.observe(st.scroller);
  st.observers.push(near, shown, resize);
}

function notifyInView(st: ViewState): void {
  let best = 0;
  let most = 0;
  for (const [page, height] of [...st.visible].sort((a, b) => a[0] - b[0])) {
    if (height > most) {
      best = page;
      most = height;
    }
  }
  if (best === 0 || best === st.inView) return;
  st.inView = best;
  st.options.onPageInView(best);
}

/** Draws the page's canvas and text layer at the box's width; a page drawn at that width already stays. */
function drawSlot(st: ViewState, slot: PageSlot): void {
  const width = slot.box.clientWidth;
  if (!st.deck || width <= 0 || width === slot.width) return;
  clearSlot(slot);
  slot.width = width;
  const canvas = renderElement("canvas", { class: "ls-paper-canvas" });
  const text = renderElement("div", { class: "ls-paper-text" });
  slot.box.prepend(canvas);
  // Above the highlights so selecting over one still works, below the pins.
  slot.marks.after(text);
  slot.layers = [canvas, text];
  void drawPdfPage(st.deck, canvas, slot.page, width);
  // A scan has no text: the page stays without a text layer, and clicks and pins work as on any page.
  void st.deck.textLayer?.(text, slot.page - 1, width / st.deck.pageSize(slot.page - 1).width).catch(() => false);
}

function clearSlot(slot: PageSlot): void {
  for (const layer of slot.layers) layer.remove();
  slot.layers = [];
  slot.width = 0;
}

/** A released pointer reports the selection made inside the view, or else the highlight under it. */
function readPointer(st: ViewState, event: PointerEvent): void {
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed) {
    const picked = readSelection(st, selection);
    if (picked) st.options.onSelection(picked);
    return;
  }
  const box = (event.target as Element | null)?.closest<HTMLElement>(".ls-paper-page");
  const slot = box ? st.slots[Number(box.dataset["page"]) - 1] : undefined;
  const frame = box ? derivePageFrame(box) : null;
  if (!slot || !frame) return;
  const point = { x: (event.clientX - frame.left) / frame.width, y: (event.clientY - frame.top) / frame.height, width: 0, height: 0 };
  const id = findHighlightAt([point], slot.highlights);
  if (id) st.options.onHighlightClick(id);
}

/** A selection across pages keeps the page it starts on and the text of all. */
function readSelection(st: ViewState, selection: Selection): PaperSelection | undefined {
  const range = selection.getRangeAt(0);
  if (!st.scroller.contains(range.commonAncestorContainer)) return undefined;
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const box = start?.closest<HTMLElement>(".ls-paper-page");
  const slot = box ? st.slots[Number(box.dataset["page"]) - 1] : undefined;
  const frame = box ? derivePageFrame(box) : null;
  if (!slot || !frame) return undefined;
  const boxes = [...range.getClientRects()].map((rect) => deriveBoxInPage(rect, frame)).filter((rect): rect is AnnotationPosition => rect !== null);
  return derivePaperSelection(slot.page, selection.toString(), boxes, slot.highlights);
}
