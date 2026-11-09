// The workspace stage: one page of the built PDF at fit or a zoom, the select and hand tools and outlines drawn over the page. The
// shell's zoom bar drives it through `surface`. Points it reports are in PDF points from the page's top-left corner, pages 1-based.
import { renderElement } from "../../../ui/dom/index.js";
import { attachFileDrop, type FileDrop } from "../../../ui/dom/projectFileDrag.js";
import type { SourceDeckRect } from "../../index.js";
import type { ShellRect, ShellTool, ShellZoomSurface } from "../shell/index.js";
import { fitRectZoom } from "../minimap.js";
import { openPdfDeck, type PdfDeck } from "../pdfDeck.js";
import type { DeckWorkspacePorts } from "./types.js";

/** An outline over the page: the selection (stale while a build runs or failed), the block under the cursor, or a poster block whose content overflows. */
export interface StageOutline { rect: SourceDeckRect; tone: "selected" | "stale" | "hover" | "overflow"; label?: string }

export interface Stage {
  element: HTMLElement;
  /** The page's sheet, sized for the zoom; `addLayer` lays an element over it (after the outlines), `scale` is its px per pt. */
  sheet: HTMLElement;
  addLayer(layer: HTMLElement): void;
  scale(): number;
  /** The next click on the sheet picks nothing (the click that ends a drag). */
  suppressClick(): void;
  /** Opens the PDF the host has now; resolves false when there is none. */
  load(): Promise<boolean>;
  pdf(): PdfDeck | undefined;
  page(): number;
  showPage(page: number): void;
  setOutlines(outlines: readonly StageOutline[]): void;
  /** A note across the stage's top, such as a write that failed; empty hides it. */
  setNote(text: string): void;
  /** Shown instead of the page while there is no PDF. */
  setEmpty(content: HTMLElement | null): void;
  /** What the shell's zoom bar drives: the zoom in percent of 96 px per inch, Fit, and the tool. */
  surface: ShellZoomSurface;
  /** The shown page's size in pt, or null while there is no PDF. */
  pageSize(): { width: number; height: number } | null;
  /** Scrolls so the page point `centre` (pt) is in the middle of the stage. */
  panTo(centre: { x: number; y: number }): void;
  /** `listener` runs after every zoom, layout, scroll and outline change of the stage. */
  onView(listener: () => void): void;
  /** Space held: the hand tool while it is down. */
  holdHand(held: boolean): void;
  /** `listener` hears the pointer's point over the page at most every HOVER_MS while it moves, and undefined when it leaves. */
  onHover(listener: (point: { page: number; x: number; y: number } | undefined) => void): void;
  dispose(): void;
}

const PX_PER_PT = 96 / 72;
const MIN_ZOOM = 10;
const MAX_ZOOM = 400;
/** How long a zoom gesture rests before the page is drawn sharp at the new scale. */
const DRAW_PAUSE_MS = 140;
const MAX_CANVAS_PIXELS = 16_000_000;
/** The least time between two hover reports. */
const HOVER_MS = 60;
/** The screen px Zoom to section keeps around the rect. */
const ZOOM_PADDING = 24;

/** What one stage keeps between calls: its elements and the shown page's zoom, tool and outlines. */
interface StageState {
  ports: Pick<DeckWorkspacePorts, "pdf">;
  onPick: (point: { page: number; x: number; y: number }) => void;
  onZoom: () => void;
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  sheet: HTMLElement;
  empty: HTMLElement;
  scroller: HTMLElement;
  note: HTMLElement;
  zoom: number | "fit";
  tool: ShellTool;
  space: boolean;
  deck: PdfDeck | undefined;
  shown: number;
  scale: number;
  /** The sharp draw a zoom gesture waits for. */
  drawTimer: ReturnType<typeof setTimeout> | undefined;
  outlines: readonly StageOutline[];
  drawing: number;
  /** A drag just ended: the click that follows it does not pick. */
  suppress: boolean;
  /** The note the workspace set, and the last draw error (empty when the page drew). */
  noteText: string;
  drawError: string;
  /** Hear every zoom, layout, scroll and outline change (the minimap). */
  views: Array<() => void>;
  /** Hear the pointer over the page (`onHover`). */
  hovers: Array<(point: { page: number; x: number; y: number } | undefined) => void>;
}

const notifyView = (st: StageState): void => { for (const listener of st.views) listener(); };

function showTool(st: StageState): void { st.element.dataset["tool"] = st.space ? "hand" : st.tool; }

/** The zoom in percent of 96 px per inch: the chosen one, or the fitted scale's while at Fit. */
const percent = (st: StageState): number => (st.zoom === "fit" ? Math.round((st.scale / PX_PER_PT) * 100) : st.zoom);

/** Sets the zoom; a gesture (`deferDraw`) stretches the page at once and draws it sharp once the gesture rests. */
function setZoom(st: StageState, next: number | "fit", deferDraw = false): void {
  st.zoom = next === "fit" ? next : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  layout(st, deferDraw);
  st.onZoom();
}

/** Sizes the sheet for the zoom and redraws the page when the scale changed, after a pause when `deferDraw`. */
function layout(st: StageState, deferDraw = false): void {
  const { deck, scroller, sheet, canvas } = st;
  if (!deck) return;
  const size = deck.pageSize(st.shown - 1);
  const fit = Math.max(0.05, Math.min((scroller.clientWidth - 32) / size.width, (scroller.clientHeight - 32) / size.height));
  const next = st.zoom === "fit" ? fit : (st.zoom / 100) * PX_PER_PT;
  sheet.style.width = `${size.width * next}px`;
  sheet.style.height = `${size.height * next}px`;
  const rescaled = next !== st.scale;
  clearTimeout(st.drawTimer);
  if (rescaled && deferDraw && canvas.dataset["page"] === String(st.shown)) {
    st.scale = next;
    canvas.style.width = `${size.width * next}px`;
    canvas.style.height = `${size.height * next}px`;
    st.drawTimer = setTimeout(() => draw(st), DRAW_PAUSE_MS);
  } else if (rescaled || canvas.dataset["page"] !== String(st.shown)) { st.scale = next; draw(st); }
  drawOutlines(st);
  if (rescaled && st.zoom === "fit") st.onZoom();
  notifyView(st);
}

function draw(st: StageState): void {
  const { deck, canvas } = st;
  if (!deck) return;
  const size = deck.pageSize(st.shown - 1);
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const render = Math.min(st.scale * ratio, Math.sqrt(MAX_CANVAS_PIXELS / (size.width * size.height)));
  canvas.dataset["page"] = String(st.shown);
  const ticket = ++st.drawing;
  const page = st.shown;
  void deck.render(canvas, page - 1, render).then(() => {
    if (ticket !== st.drawing) return;
    canvas.style.width = `${size.width * st.scale}px`;
    canvas.style.height = `${size.height * st.scale}px`;
    showDrawError(st, "");
  }, (error: unknown) => {
    console.warn(`Deck workspace: page ${page} failed to draw`, error);
    if (ticket !== st.drawing) return;
    const reason = error instanceof Error ? error.message : String(error);
    showDrawError(st, `Page ${page} could not be drawn: ${reason}`.split("\n")[0] ?? "");
  });
}

/** The stage note shows a draw error while there is one, otherwise the note the workspace set. */
function showDrawError(st: StageState, text: string): void {
  st.drawError = text;
  const shown = text || st.noteText;
  st.note.textContent = shown;
  st.note.hidden = !shown;
}

function drawOutlines(st: StageState): void {
  const { scale } = st;
  st.overlay.replaceChildren(...st.outlines.filter((o) => o.rect.page === st.shown).map((o) => {
    const box = renderElement("div", { class: `dw-outline dw-outline-${o.tone}${o.tone === "overflow" ? " is-overflow" : ""}` });
    Object.assign(box.style, { left: `${o.rect.left * scale}px`, top: `${o.rect.top * scale}px`, width: `${(o.rect.right - o.rect.left) * scale}px`, height: `${(o.rect.bottom - o.rect.top) * scale}px` });
    if (o.label) box.append(renderElement("span", { class: "dw-outline-label", text: o.label }));
    return box;
  }));
}

/** Select: a click picks the point; Hand (or Space held): a drag pans the stage. */
function wirePointer(st: StageState): void {
  const { sheet, scroller } = st;
  let pan: { x: number; y: number; left: number; top: number } | null = null;
  sheet.addEventListener("pointerdown", (event) => {
    st.suppress = false;
    if (st.tool === "hand" || st.space || event.button === 1) {
      pan = { x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
      sheet.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  });
  sheet.addEventListener("pointermove", (event) => {
    if (!pan) return;
    scroller.scrollLeft = pan.left - (event.clientX - pan.x);
    scroller.scrollTop = pan.top - (event.clientY - pan.y);
  });
  sheet.addEventListener("pointerup", () => { pan = null; });
  sheet.addEventListener("click", (event) => {
    if (st.suppress) { st.suppress = false; return; }
    if (st.tool !== "select" || st.space || !st.deck) return;
    st.onPick(pointOf(st, event));
  });
}

/** Reports the pointer over the page to the hover listeners: the latest point once per HOVER_MS while it moves, undefined when it leaves. */
function wireHover(st: StageState): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: { page: number; x: number; y: number } | undefined;
  const report = (point: typeof last): void => { for (const listener of st.hovers) listener(point); };
  st.sheet.addEventListener("pointermove", (event) => {
    if (!st.deck || st.hovers.length === 0) return;
    last = pointOf(st, event);
    timer ??= setTimeout(() => { timer = undefined; report(last); }, HOVER_MS);
  });
  st.sheet.addEventListener("pointerleave", () => { clearTimeout(timer); timer = undefined; last = undefined; report(undefined); });
}

/**
 * Zooms on a pinch (the browser's Ctrl wheel) or Cmd/Ctrl with the wheel, in proportion to the wheel's distance and around the pointer;
 * refits on resize; returns the resize observer.
 */
function wireZoom(st: StageState): ResizeObserver | undefined {
  st.scroller.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!st.deck) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    const factor = Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.01);
    const before = st.sheet.getBoundingClientRect();
    const scale = st.scale || 1;
    const at = { x: (event.clientX - before.left) / scale, y: (event.clientY - before.top) / scale };
    setZoom(st, percent(st) * factor, true);
    // The point under the pointer stays under it.
    const after = st.sheet.getBoundingClientRect();
    st.scroller.scrollLeft += after.left + at.x * st.scale - event.clientX;
    st.scroller.scrollTop += after.top + at.y * st.scale - event.clientY;
    notifyView(st);
  }, { passive: false });
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => { if (st.zoom === "fit") layout(st); });
  resize?.observe(st.scroller);
  return resize;
}

/** The state with the stage's elements. */
function createState(ports: Pick<DeckWorkspacePorts, "pdf">, onPick: StageState["onPick"], onZoom: () => void): StageState {
  const canvas = renderElement("canvas", { class: "dw-canvas" });
  const overlay = renderElement("div", { class: "dw-overlay" });
  const sheet = renderElement("div", { class: "dw-sheet" }, canvas, overlay);
  const empty = renderElement("div", { class: "dw-empty", hidden: true });
  const scroller = renderElement("div", { class: "dw-scroller" }, sheet, empty);
  const note = renderElement("div", { class: "dw-stage-note", role: "status", hidden: true });
  return {
    ports, onPick, onZoom, canvas, overlay, sheet, empty, scroller, note,
    element: renderElement("div", { class: "dw-stage" }, note, scroller),
    zoom: "fit", tool: "select", space: false, deck: undefined, shown: 1, scale: 1, drawTimer: undefined, outlines: [], drawing: 0, suppress: false, noteText: "", drawError: "", views: [], hovers: [],
  };
}

async function loadPdf(st: StageState): Promise<boolean> {
  const { ports } = st;
  const bytes = await ports.pdf.read();
  if (!bytes) return false;
  const next = await openPdfDeck({ assets: ports.pdf.assets, readBytes: async () => bytes, ...(ports.pdf.createWorker ? { createWorker: ports.pdf.createWorker } : {}) });
  st.deck?.destroy();
  st.deck = next;
  st.shown = Math.min(Math.max(1, st.shown), next.count);
  st.scale = 0;
  st.sheet.hidden = false;
  st.empty.hidden = true;
  layout(st);
  return true;
}


/** The sheet's offset in the scroller's content, in px. */
function sheetOffset(st: StageState): { x: number; y: number } {
  const sheet = st.sheet.getBoundingClientRect();
  const scroller = st.scroller.getBoundingClientRect();
  return { x: sheet.left - scroller.left + st.scroller.scrollLeft, y: sheet.top - scroller.top + st.scroller.scrollTop };
}

function panTo(st: StageState, centre: { x: number; y: number }): void {
  if (!st.deck) return;
  const offset = sheetOffset(st);
  st.scroller.scrollLeft = offset.x + centre.x * st.scale - st.scroller.clientWidth / 2;
  st.scroller.scrollTop = offset.y + centre.y * st.scale - st.scroller.clientHeight / 2;
  notifyView(st);
}

/** The visible part of the shown page in pt. */
function viewport(st: StageState): ShellRect | null {
  if (!st.deck || st.sheet.hidden) return null;
  const sheet = st.sheet.getBoundingClientRect();
  const scroller = st.scroller.getBoundingClientRect();
  const scale = st.scale || 1;
  return { left: (scroller.left - sheet.left) / scale, top: (scroller.top - sheet.top) / scale, width: st.scroller.clientWidth / scale, height: st.scroller.clientHeight / scale };
}

/** Zoom to section: the zoom fitting `rect` (pt), then the rect centred. */
function zoomToRect(st: StageState, rect: ShellRect): void {
  if (!st.deck || rect.width <= 0 || rect.height <= 0) return;
  const view = { width: st.scroller.clientWidth, height: st.scroller.clientHeight };
  setZoom(st, fitRectZoom({ width: rect.width * PX_PER_PT, height: rect.height * PX_PER_PT }, view, ZOOM_PADDING));
  panTo(st, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
}

/** The point of a pointer event on the shown page, in PDF points from its top-left corner. */
function pointOf(st: StageState, event: MouseEvent): { page: number; x: number; y: number } {
  const bounds = st.sheet.getBoundingClientRect();
  const scale = st.scale || 1;
  return { page: st.shown, x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
}

/** Shows page `page`, kept within the deck. */
function showPage(st: StageState, page: number): void {
  if (!st.deck) return;
  const next = Math.min(Math.max(1, page), st.deck.count);
  if (next === st.shown) return;
  st.shown = next;
  layout(st);
}

/** The zoom and tool surface the shell drives. */
function createSurface(st: StageState): Stage["surface"] {
  return {
    percent: () => percent(st),
    isFit: () => st.zoom === "fit",
    setZoom: (next) => setZoom(st, next),
    setTool(next) { st.tool = next; showTool(st); },
    zoomToRect: (rect) => zoomToRect(st, rect),
    viewport: () => viewport(st),
  };
}

/**
 * `onZoom` hears every change of the zoom or of the fitted scale; `onDrop`, when given, takes files dropped on the stage with the point
 * on the shown page.
 */
export function createStage(
  ports: Pick<DeckWorkspacePorts, "pdf">, onPick: (point: { page: number; x: number; y: number }) => void, onZoom: () => void = () => undefined,
  onDrop?: (drop: FileDrop, point: { page: number; x: number; y: number }) => void,
): Stage {
  const st = createState(ports, onPick, onZoom);
  showTool(st);
  wirePointer(st);
  wireHover(st);
  attachFileDrop(st.element, onDrop && ((drop, event) => onDrop(drop, pointOf(st, event))));
  const resize = wireZoom(st);
  st.scroller.addEventListener("scroll", () => notifyView(st), { passive: true });

  return {
    element: st.element,
    sheet: st.sheet,
    addLayer(layer) { st.sheet.append(layer); },
    scale: () => st.scale || 1,
    suppressClick() { st.suppress = true; },
    load: () => loadPdf(st),
    pdf: () => st.deck,
    page: () => st.shown,
    showPage: (page) => showPage(st, page),
    setOutlines(next) { st.outlines = next; drawOutlines(st); notifyView(st); },
    setNote(text) { st.noteText = text; showDrawError(st, st.drawError); },
    setEmpty(content) {
      st.empty.replaceChildren(...(content ? [content] : []));
      st.empty.hidden = !content;
      st.sheet.hidden = Boolean(content) || !st.deck;
    },
    surface: createSurface(st),
    pageSize: () => (st.deck ? st.deck.pageSize(st.shown - 1) : null),
    panTo: (centre) => panTo(st, centre),
    onView(listener) { st.views.push(listener); },
    holdHand(held) { st.space = held; showTool(st); },
    onHover(listener) { st.hovers.push(listener); },
    dispose() {
      clearTimeout(st.drawTimer);
      resize?.disconnect();
      st.deck?.destroy();
    },
  };
}
