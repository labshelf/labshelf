// The workspace stage: one page of the built PDF at fit or 25–400% zoom, the select and hand tools, outlines drawn over the page and a
// floating bar placed above the selection. Points it reports are in PDF points from the page's top-left corner, pages 1-based.
import { renderElement, renderIcon, type IconName } from "../../../ui/dom/index.js";
import type { SourceDeckRect } from "../../index.js";
import { openPdfDeck, type PdfDeck } from "../pdfDeck.js";
import type { DeckWorkspacePorts } from "./types.js";

/** An outline over the page: the selection, the node under the cursor or every block while Guides is on. */
export interface StageOutline { rect: SourceDeckRect; tone: "selected" | "guide" | "hover"; label?: string }

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

export function createStage(ports: Pick<DeckWorkspacePorts, "pdf">, onPick: (point: { page: number; x: number; y: number }) => void, onChange: () => void): Stage {
  const canvas = renderElement("canvas", { class: "dw-canvas" });
  const overlay = renderElement("div", { class: "dw-overlay" });
  const sheet = renderElement("div", { class: "dw-sheet" }, canvas, overlay);
  const empty = renderElement("div", { class: "dw-empty", hidden: true });
  const scroller = renderElement("div", { class: "dw-scroller" }, sheet, empty);
  const note = renderElement("div", { class: "dw-stage-note", role: "status", hidden: true });
  const zoomLabel = renderElement("span", { class: "dw-zoom-label" });
  let zoom: number | "fit" = "fit";
  let tool: "select" | "hand" = "select";
  let guides = false;
  const selectTool = toolButton("target", "Select", () => setTool("select"));
  const handTool = toolButton("move", "Hand (hold Space)", () => setTool("hand"));
  const guidesButton = toolButton("grid", "Guides", () => { guides = !guides; guidesButton.setAttribute("aria-pressed", String(guides)); onChange(); });
  guidesButton.setAttribute("aria-pressed", "false");
  const zoomBar = renderElement("div", { class: "dw-zoombar", role: "toolbar", "aria-label": "Stage" },
    selectTool, handTool, guidesButton, renderElement("span", { class: "dw-zoombar-rule" }),
    toolButton("minus", "Zoom out", () => step(-1)), zoomLabel, toolButton("plus", "Zoom in", () => step(1)),
    renderElement("button", { type: "button", class: "dw-zoom-fit", text: "Fit", title: "Fit the page" }));
  zoomBar.querySelector(".dw-zoom-fit")!.addEventListener("click", () => setZoom("fit"));
  const element = renderElement("div", { class: "dw-stage" }, note, scroller, zoomBar);

  let deck: PdfDeck | undefined;
  let shown = 1;
  let scale = 1;
  let outlines: readonly StageOutline[] = [];
  let drawing = 0;

  function setTool(next: "select" | "hand"): void {
    tool = next;
    selectTool.setAttribute("aria-pressed", String(next === "select"));
    handTool.setAttribute("aria-pressed", String(next === "hand"));
    element.dataset["tool"] = next;
  }
  setTool("select");

  const percent = (): number => Math.round((scale / PX_PER_PT) * 100);
  function step(by: 1 | -1): void {
    const current = percent();
    const next = by > 0 ? ZOOM_STEPS.find((z) => z > current) ?? 400 : [...ZOOM_STEPS].reverse().find((z) => z < current) ?? 25;
    setZoom(next);
  }
  function setZoom(next: number | "fit"): void { zoom = next; layout(); }

  /** Sizes the sheet for the zoom and redraws the page when the scale changed. */
  function layout(): void {
    if (!deck) return;
    const size = deck.pageSize(shown - 1);
    const fit = Math.max(0.05, Math.min((scroller.clientWidth - 32) / size.width, (scroller.clientHeight - 32) / size.height));
    const next = zoom === "fit" ? fit : (zoom / 100) * PX_PER_PT;
    zoomLabel.textContent = zoom === "fit" ? `Fit · ${Math.round((next / PX_PER_PT) * 100)}%` : `${zoom}%`;
    sheet.style.width = `${size.width * next}px`;
    sheet.style.height = `${size.height * next}px`;
    if (next !== scale || canvas.dataset["page"] !== String(shown)) { scale = next; draw(); }
    drawOutlines();
  }

  function draw(): void {
    if (!deck) return;
    const size = deck.pageSize(shown - 1);
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const render = Math.min(scale * ratio, Math.sqrt(MAX_CANVAS_PIXELS / (size.width * size.height)));
    canvas.dataset["page"] = String(shown);
    const ticket = ++drawing;
    void deck.render(canvas, shown - 1, render).then(() => {
      if (ticket !== drawing) return;
      canvas.style.width = `${size.width * scale}px`;
      canvas.style.height = `${size.height * scale}px`;
    }).catch(() => undefined);
  }

  function drawOutlines(): void {
    overlay.replaceChildren(...outlines.filter((o) => o.rect.page === shown).map((o) => {
      const box = renderElement("div", { class: `dw-outline dw-outline-${o.tone}` });
      Object.assign(box.style, { left: `${o.rect.left * scale}px`, top: `${o.rect.top * scale}px`, width: `${(o.rect.right - o.rect.left) * scale}px`, height: `${(o.rect.bottom - o.rect.top) * scale}px` });
      if (o.label) box.append(renderElement("span", { class: "dw-outline-label", text: o.label }));
      return box;
    }));
  }

  // Select: a click picks the point; Hand (or Space held): a drag pans the stage.
  let pan: { x: number; y: number; left: number; top: number } | null = null;
  let space = false;
  sheet.addEventListener("pointerdown", (event) => {
    if (tool === "hand" || space || event.button === 1) {
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
    if (tool !== "select" || space || !deck) return;
    const bounds = sheet.getBoundingClientRect();
    onPick({ page: shown, x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale });
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || (event.target as HTMLElement | null)?.closest?.("input, textarea, .cm-editor, [contenteditable]")) return;
    space = event.type === "keydown";
    element.dataset["tool"] = space ? "hand" : tool;
    if (space) event.preventDefault();
  };
  globalThis.addEventListener("keydown", onKey);
  globalThis.addEventListener("keyup", onKey);
  scroller.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(Math.min(400, Math.max(25, Math.round(percent() * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))));
  }, { passive: false });
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => { if (zoom === "fit") layout(); });
  resize?.observe(scroller);

  return {
    element,
    async load() {
      const bytes = await ports.pdf.read();
      if (!bytes) return false;
      const next = await openPdfDeck({ assets: ports.pdf.assets, readBytes: async () => bytes, ...(ports.pdf.createWorker ? { createWorker: ports.pdf.createWorker } : {}) });
      deck?.destroy();
      deck = next;
      shown = Math.min(Math.max(1, shown), deck.count);
      scale = 0;
      sheet.hidden = false;
      empty.hidden = true;
      layout();
      return true;
    },
    pdf: () => deck,
    page: () => shown,
    showPage(page) {
      if (!deck) return;
      const next = Math.min(Math.max(1, page), deck.count);
      if (next === shown) return;
      shown = next;
      layout();
    },
    setOutlines(next) { outlines = next; drawOutlines(); },
    placeBar(bar, rect) {
      if (!rect || rect.page !== shown || !deck) { bar.hidden = true; return; }
      if (bar.parentElement !== sheet) sheet.append(bar);
      bar.hidden = false;
      bar.style.left = `${rect.left * scale}px`;
      bar.style.top = `${Math.max(0, rect.top * scale - 34)}px`;
    },
    setNote(text) { note.textContent = text; note.hidden = !text; },
    setEmpty(content) {
      empty.replaceChildren(...(content ? [content] : []));
      empty.hidden = !content;
      sheet.hidden = Boolean(content) || !deck;
    },
    guides: () => guides,
    dispose() {
      resize?.disconnect();
      globalThis.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("keyup", onKey);
      deck?.destroy();
    },
  };
}
