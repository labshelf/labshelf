// The workspace stage: one page of the built PDF at fit or 25–400% zoom, the select and hand tools, outlines drawn over the page and a
// floating bar placed above the selection. Points it reports are in PDF points from the page's top-left corner, pages 1-based.
import { renderElement, renderIcon, type IconName } from "../../../ui/dom/index.js";
import type { SourceDeckRect } from "../../index.js";
import { openPdfDeck, type PdfDeck } from "../pdfDeck.js";
import type { DeckWorkspacePorts } from "./types.js";

/** An outline over the page: the selection (stale while a build runs or failed), the node under the cursor or every block while Guides is on. */
export interface StageOutline { rect: SourceDeckRect; tone: "selected" | "stale" | "guide" | "hover"; label?: string }

export interface Stage {
  element: HTMLElement;
  /** Opens the PDF the host has now; resolves false when there is none. */
  load(): Promise<boolean>;
  pdf(): PdfDeck | undefined;
  page(): number;
  showPage(page: number): void;
  setOutlines(outlines: readonly StageOutline[]): void;
  /** Shows `bar` above `rect` on the shown page, or hides it when rect is undefined. */
  placeBar(bar: HTMLElement, rect: SourceDeckRect | undefined): void;
  /** A note across the stage's top, such as why the stage follows by page; empty hides it. */
  setNote(text: string): void;
  /** Shown instead of the page while there is no PDF. */
  setEmpty(content: HTMLElement | null): void;
  guides(): boolean;
  dispose(): void;
}

const PX_PER_PT = 96 / 72;
const ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 300, 400];
const MAX_CANVAS_PIXELS = 16_000_000;

function toolButton(icon: IconName, label: string, run: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "dw-tool", title: label, "aria-label": label, html: renderIcon(icon) });
  button.addEventListener("click", run);
  return button;
}

/** What one stage keeps between calls: its elements and the shown page's zoom, tool and outlines. */
interface StageState {
  ports: Pick<DeckWorkspacePorts, "pdf">;
  onPick: (point: { page: number; x: number; y: number }) => void;
  onChange: () => void;
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  sheet: HTMLElement;
  empty: HTMLElement;
  scroller: HTMLElement;
  note: HTMLElement;
  zoomLabel: HTMLElement;
  selectTool: HTMLButtonElement;
  handTool: HTMLButtonElement;
  guidesButton: HTMLButtonElement;
  zoom: number | "fit";
  tool: "select" | "hand";
  guides: boolean;
  space: boolean;
  deck: PdfDeck | undefined;
  shown: number;
  scale: number;
  outlines: readonly StageOutline[];
  drawing: number;
  /** The note the workspace set, and the last draw error (empty when the page drew). */
  noteText: string;
  drawError: string;
}

function setTool(st: StageState, next: "select" | "hand"): void {
  st.tool = next;
  st.selectTool.setAttribute("aria-pressed", String(next === "select"));
  st.handTool.setAttribute("aria-pressed", String(next === "hand"));
  st.element.dataset["tool"] = next;
}

const percent = (st: StageState): number => Math.round((st.scale / PX_PER_PT) * 100);

function setZoom(st: StageState, next: number | "fit"): void { st.zoom = next; layout(st); }

function step(st: StageState, by: 1 | -1): void {
  const current = percent(st);
  setZoom(st, by > 0 ? ZOOM_STEPS.find((z) => z > current) ?? 400 : [...ZOOM_STEPS].reverse().find((z) => z < current) ?? 25);
}

/** Sizes the sheet for the zoom and redraws the page when the scale changed. */
function layout(st: StageState): void {
  const { deck, scroller, sheet, canvas } = st;
  if (!deck) return;
  const size = deck.pageSize(st.shown - 1);
  const fit = Math.max(0.05, Math.min((scroller.clientWidth - 32) / size.width, (scroller.clientHeight - 32) / size.height));
  const next = st.zoom === "fit" ? fit : (st.zoom / 100) * PX_PER_PT;
  st.zoomLabel.textContent = st.zoom === "fit" ? `Fit · ${Math.round((next / PX_PER_PT) * 100)}%` : `${st.zoom}%`;
  sheet.style.width = `${size.width * next}px`;
  sheet.style.height = `${size.height * next}px`;
  if (next !== st.scale || canvas.dataset["page"] !== String(st.shown)) { st.scale = next; draw(st); }
  drawOutlines(st);
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
    const box = renderElement("div", { class: `dw-outline dw-outline-${o.tone}` });
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
    if (st.tool !== "select" || st.space || !st.deck) return;
    const bounds = sheet.getBoundingClientRect();
    st.onPick({ page: st.shown, x: (event.clientX - bounds.left) / st.scale, y: (event.clientY - bounds.top) / st.scale });
  });
}

/** Holds Space for the hand tool and zooms on Ctrl or Cmd with the wheel; returns the key handler and the resize observer. */
function wireKeysAndZoom(st: StageState): { onKey: (event: KeyboardEvent) => void; resize: ResizeObserver | undefined } {
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || (event.target as HTMLElement | null)?.closest?.("input, textarea, .cm-editor, [contenteditable]")) return;
    st.space = event.type === "keydown";
    st.element.dataset["tool"] = st.space ? "hand" : st.tool;
    if (st.space) event.preventDefault();
  };
  globalThis.addEventListener("keydown", onKey);
  globalThis.addEventListener("keyup", onKey);
  st.scroller.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(st, Math.min(400, Math.max(25, Math.round(percent(st) * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))));
  }, { passive: false });
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => { if (st.zoom === "fit") layout(st); });
  resize?.observe(st.scroller);
  return { onKey, resize };
}

/** The state with the stage's elements and tool buttons; the zoom bar is added by `buildZoomBar`. */
function createState(ports: Pick<DeckWorkspacePorts, "pdf">, onPick: StageState["onPick"], onChange: () => void): StageState {
  const canvas = renderElement("canvas", { class: "dw-canvas" });
  const overlay = renderElement("div", { class: "dw-overlay" });
  const sheet = renderElement("div", { class: "dw-sheet" }, canvas, overlay);
  const empty = renderElement("div", { class: "dw-empty", hidden: true });
  const scroller = renderElement("div", { class: "dw-scroller" }, sheet, empty);
  const note = renderElement("div", { class: "dw-stage-note", role: "status", hidden: true });
  const st: StageState = {
    ports, onPick, onChange, canvas, overlay, sheet, empty, scroller, note, zoomLabel: renderElement("span", { class: "dw-zoom-label" }),
    element: renderElement("div", { class: "dw-stage" }, note, scroller),
    selectTool: toolButton("target", "Select", () => setTool(st, "select")),
    handTool: toolButton("move", "Hand (hold Space)", () => setTool(st, "hand")),
    guidesButton: toolButton("grid", "Guides", () => { st.guides = !st.guides; st.guidesButton.setAttribute("aria-pressed", String(st.guides)); onChange(); }),
    zoom: "fit", tool: "select", guides: false, space: false, deck: undefined, shown: 1, scale: 1, outlines: [], drawing: 0, noteText: "", drawError: "",
  };
  return st;
}

function buildZoomBar(st: StageState): HTMLElement {
  st.guidesButton.setAttribute("aria-pressed", "false");
  const zoomBar = renderElement("div", { class: "dw-zoombar", role: "toolbar", "aria-label": "Stage" },
    st.selectTool, st.handTool, st.guidesButton, renderElement("span", { class: "dw-zoombar-rule" }),
    toolButton("minus", "Zoom out", () => step(st, -1)), st.zoomLabel, toolButton("plus", "Zoom in", () => step(st, 1)),
    renderElement("button", { type: "button", class: "dw-zoom-fit", text: "Fit", title: "Fit the page" }));
  zoomBar.querySelector(".dw-zoom-fit")!.addEventListener("click", () => setZoom(st, "fit"));
  return zoomBar;
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

function placeBar(st: StageState, bar: HTMLElement, rect: SourceDeckRect | undefined): void {
  if (!rect || rect.page !== st.shown || !st.deck) { bar.hidden = true; return; }
  if (bar.parentElement !== st.sheet) st.sheet.append(bar);
  bar.hidden = false;
  bar.style.left = `${rect.left * st.scale}px`;
  bar.style.top = `${Math.max(0, rect.top * st.scale - 34)}px`;
}

export function createStage(ports: Pick<DeckWorkspacePorts, "pdf">, onPick: (point: { page: number; x: number; y: number }) => void, onChange: () => void): Stage {
  const st = createState(ports, onPick, onChange);
  st.element.append(buildZoomBar(st));
  setTool(st, "select");
  wirePointer(st);
  const { onKey, resize } = wireKeysAndZoom(st);

  return {
    element: st.element,
    load: () => loadPdf(st),
    pdf: () => st.deck,
    page: () => st.shown,
    showPage(page) {
      if (!st.deck) return;
      const next = Math.min(Math.max(1, page), st.deck.count);
      if (next === st.shown) return;
      st.shown = next;
      layout(st);
    },
    setOutlines(next) { st.outlines = next; drawOutlines(st); },
    placeBar: (bar, rect) => placeBar(st, bar, rect),
    setNote(text) { st.noteText = text; showDrawError(st, st.drawError); },
    setEmpty(content) {
      st.empty.replaceChildren(...(content ? [content] : []));
      st.empty.hidden = !content;
      st.sheet.hidden = Boolean(content) || !st.deck;
    },
    guides: () => st.guides,
    dispose() {
      resize?.disconnect();
      globalThis.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("keyup", onKey);
      st.deck?.destroy();
    },
  };
}
