// Poster preview (D10): the whole poster in one deck frame with Mod+wheel zoom, drag pan, mm or in rulers, a one-time card calibration
// kept through a CalibrationStore, the text leaves below the small-text threshold listed and marked on the canvas, and the print check.
import { renderElement } from "../../ui/dom/index.js";
import { parseDeck } from "../deckParse.js";
import { checkPosterPrint, type PrintCheckInput, type PrintIssue } from "../deckPrintCheck.js";
import { deckCanvasPx, type DeckSize } from "../deckSizes.js";
import { calibrationFromCard, clampPosterZoom, rulerTicks, smallTextThresholdPt, type CalibrationStore, type PosterCalibration, type RulerUnit } from "../posterMeasure.js";
import { mountDeckFrame, type DeckFrame, type DeckFrameOptions } from "./deckFrame.js";
import { framePrintInput, showPrintCheck } from "./posterPrintCheck.js";

export interface PosterPreviewOptions { html: string; theme: string; store: CalibrationStore; resolveAsset: (path: string) => Promise<string>; loadMath?: DeckFrameOptions["loadMath"]; unit?: RulerUnit; onSelectLeaf?: (block: string, leaf: number) => void }

export interface SmallTextFlag { block: string; leaf: number; pt: number; text: string }

export interface PosterPreviewController { zoom(): number; setZoom(zoom: number): void; setUnit(unit: RulerUnit): void; smallText(): SmallTextFlag[]; printIssues(): PrintIssue[]; calibrated(): boolean; destroy(): void }

/** A rect in canvas px. */
export interface CanvasRect { left: number; top: number; width: number; height: number }

/** The poster drawn in the canvas box: ready once drawn, then the text below a print size with its rects in canvas px, and optionally its measures for the print check. */
export interface MountedPoster { ready: Promise<void>; smallText(thresholdPt: number): Array<SmallTextFlag & { rect: CanvasRect }>; printInput?(): PrintCheckInput; destroy(): void }

/** What a poster preview shows: the canvas in px (96 px per inch of print), the small-text threshold for its size, and how it is drawn. */
export interface PosterContent { canvas: { width: number; height: number }; thresholdPt: number; mount(canvasBox: HTMLElement): MountedPoster }

/** The poster preview options of any poster content: the deck-specific ones replaced by the content. */
export type ContentPosterPreviewOptions = Omit<PosterPreviewOptions, "html" | "theme" | "resolveAsset" | "loadMath"> & { content: PosterContent };

const SVG_NS = "http://www.w3.org/2000/svg";
const RULER = 24;
const DEFAULT_PX_PER_MM = 96 / 25.4;
const CARD_MM = 85.6;
const WHEEL_STEP = 1.1;
const LIST_TEXT_CHARS = 40;
let previewCount = 0;

const px = (value: number): string => `${value}px`;

function svgElement(doc: Document, name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const element = doc.createElementNS(SVG_NS, name) as SVGElement;
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Redraws one ruler strip: ticks along the canvas length at the given screen scale and pan, only those in view. */
function drawRuler(svg: SVGElement, horizontal: boolean, length: number, span: number, unit: RulerUnit, scale: number, pan: number): void {
  const doc = svg.ownerDocument;
  const width = horizontal ? span : RULER;
  const height = horizontal ? RULER : span;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const parts: SVGElement[] = [];
  for (const tick of rulerTicks(length, unit, scale)) {
    const at = Math.round((pan + tick.offset * scale) * 100) / 100;
    if (at < 0 || at > span) continue;
    const reach = RULER - (tick.major ? 12 : 6);
    parts.push(horizontal ? svgElement(doc, "line", { x1: at, x2: at, y1: reach, y2: RULER }) : svgElement(doc, "line", { y1: at, y2: at, x1: reach, x2: RULER }));
    if (tick.label !== null) parts.push(svgElement(doc, "text", horizontal ? { x: at + 2, y: 9 } : { x: 2, y: at + 9 }, tick.label));
  }
  svg.replaceChildren(...parts);
}

const roundPt = (pt: number): number => Math.round(pt * 10) / 10;

/** The leaves whose print size (computed px * 0.75) is strictly below the threshold, in leaf order, with their rects in canvas px. */
function findSmallText(frame: DeckFrame, thresholdPt: number): Array<SmallTextFlag & { rect: CanvasRect }> {
  const view = frame.frame.contentWindow;
  if (!view) return [];
  return frame.leaves().flatMap(({ block, index, element }) => {
    const pt = Number.parseFloat(view.getComputedStyle(element).fontSize) * 0.75;
    if (!Number.isFinite(pt) || pt >= thresholdPt) return [];
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return [{ block, leaf: index, pt: roundPt(pt), text, rect: element.getBoundingClientRect() }];
  });
}

interface PosterState { calibration: PosterCalibration | undefined; unit: RulerUnit; zoom: number; pan: { x: number; y: number }; destroyed: boolean; flags: SmallTextFlag[]; issues: PrintIssue[] }

interface PosterCanvas { width: number; height: number }

interface PosterView {
  root: HTMLElement;
  tools: HTMLElement;
  status: HTMLElement;
  zoomLabel: HTMLElement;
  calibrateButton: HTMLButtonElement;
  unitButtons: Record<RulerUnit, HTMLButtonElement>;
  topRuler: SVGElement;
  leftRuler: SVGElement;
  canvasBox: HTMLElement;
  viewport: HTMLElement;
  aside: HTMLElement;
  listHeading: HTMLElement;
  list: HTMLElement;
}

interface PosterMeasure { pxPerMm(): number; viewSize(): { width: number; height: number }; render(): void; zoomAt(next: number, x: number, y: number): void; fit(): void; centreOn(box: CanvasRect): void }

/** The toolbar: unit buttons, calibration status, the Calibrate button and the zoom label. */
function buildPosterTools(unit: RulerUnit, onUnit: (unit: RulerUnit) => void): Pick<PosterView, "tools" | "status" | "zoomLabel" | "calibrateButton" | "unitButtons"> {
  const unitButton = (value: RulerUnit): HTMLButtonElement => {
    const b = renderElement("button", { type: "button", class: "ls-poster-unit", text: value, "aria-pressed": String(value === unit), title: value === "mm" ? "Ruler in millimetres" : "Ruler in inches" });
    b.addEventListener("click", () => onUnit(value));
    return b;
  };
  const unitButtons = { mm: unitButton("mm"), in: unitButton("in") };
  const status = renderElement("span", { class: "ls-poster-calibration", role: "status" });
  const zoomLabel = renderElement("span", { class: "ls-poster-zoom", "aria-label": "Zoom" });
  const calibrateButton = renderElement("button", { type: "button", class: "ls-poster-calibrate-open", text: "Calibrate" });
  const tools = renderElement("div", { class: "ls-poster-tools", role: "toolbar", "aria-label": "Ruler" },
    renderElement("span", { class: "ls-poster-units", role: "group", "aria-label": "Ruler unit" }, unitButtons.mm, unitButtons.in), status, calibrateButton, zoomLabel);
  return { tools, status, zoomLabel, calibrateButton, unitButtons };
}

/** Builds the preview's DOM (toolbar, rulers, canvas viewport, small-text aside) into host; the fixed layout is in deck-editor.css. */
function buildPosterView(host: HTMLElement, canvas: PosterCanvas, unit: RulerUnit, onUnit: (unit: RulerUnit) => void, id: string): PosterView {
  // What changes is written through element.style, which a webview CSP allows.
  const root = renderElement("div", { class: "ls-poster-preview", "data-poster-preview": id, role: "region", "aria-label": "Poster preview" });
  host.append(root);
  const toolbar = buildPosterTools(unit, onUnit);
  const topRuler = svgElement(host.ownerDocument, "svg", { class: "ls-poster-ruler-top", "aria-hidden": "true" });
  const leftRuler = svgElement(host.ownerDocument, "svg", { class: "ls-poster-ruler-left", "aria-hidden": "true" });
  const canvasBox = renderElement("div", { class: "ls-poster-canvas" });
  canvasBox.style.width = px(canvas.width);
  canvasBox.style.height = px(canvas.height);
  const viewport = renderElement("div", { class: "ls-poster-viewport" }, canvasBox);
  const stage = renderElement("div", { class: "ls-poster-stage" }, topRuler, leftRuler, viewport);
  const listHeading = renderElement("h2", { class: "ls-poster-small-heading" });
  const list = renderElement("ul", { class: "ls-poster-small-list" });
  const aside = renderElement("aside", { class: "ls-poster-small", "data-small-text": true, "aria-label": "Print check" }, listHeading, list);
  root.append(toolbar.tools, renderElement("div", { class: "ls-poster-body" }, stage, aside));
  return { root, ...toolbar, topRuler, leftRuler, canvasBox, viewport, aside, listHeading, list };
}

/** Zoom, pan, fit and the redraw of the canvas transform, rulers and labels, over the shared state. */
function createMeasure(host: HTMLElement, view: PosterView, canvas: PosterCanvas, ps: PosterState): PosterMeasure {
  const pxPerMm = (): number => ps.calibration?.pxPerMm ?? DEFAULT_PX_PER_MM;
  /** Screen px per canvas px: zoom 1 is real size, one mm spanning pxPerMm screen px. */
  const scale = (): number => (ps.zoom * pxPerMm()) / DEFAULT_PX_PER_MM;
  /** The viewport size; before layout gives it one, the host's size less the rulers. */
  const viewSize = (): { width: number; height: number } => ({
    width: view.viewport.clientWidth || Math.max(0, host.clientWidth - RULER),
    height: view.viewport.clientHeight || Math.max(0, host.clientHeight - RULER),
  });
  const render = (): void => {
    if (ps.destroyed) return;
    const s = scale();
    const size = viewSize();
    view.canvasBox.style.transform = `translate(${ps.pan.x}px, ${ps.pan.y}px) scale(${s})`;
    drawRuler(view.topRuler, true, canvas.width, size.width, ps.unit, s, ps.pan.x);
    drawRuler(view.leftRuler, false, canvas.height, size.height, ps.unit, s, ps.pan.y);
    for (const value of ["mm", "in"] as const) view.unitButtons[value].setAttribute("aria-pressed", String(value === ps.unit));
    view.status.textContent = ps.calibration ? `Calibrated ${ps.calibration.measuredAt.slice(0, 10)}` : "Not calibrated";
    view.zoomLabel.textContent = `${Math.round(ps.zoom * 100)}%`;
  };
  /** Sets the zoom keeping the viewport point (x, y) over the same canvas point. */
  const zoomAt = (next: number, x: number, y: number): void => {
    const before = scale();
    ps.zoom = clampPosterZoom(next);
    const ratio = scale() / before;
    ps.pan.x = x - (x - ps.pan.x) * ratio;
    ps.pan.y = y - (y - ps.pan.y) * ratio;
    render();
  };
  const fit = (): void => {
    const size = viewSize();
    const fitScale = Math.min(size.width / canvas.width, size.height / canvas.height);
    ps.zoom = clampPosterZoom(fitScale > 0 ? (fitScale * DEFAULT_PX_PER_MM) / pxPerMm() : 1);
    const s = scale();
    ps.pan.x = (size.width - canvas.width * s) / 2;
    ps.pan.y = (size.height - canvas.height * s) / 2;
    render();
  };
  /** Pans (zoom unchanged) so the centre of the canvas box sits at the centre of the viewport. */
  const centreOn = (box: CanvasRect): void => {
    const size = viewSize();
    const s = scale();
    ps.pan.x = size.width / 2 - (box.left + box.width / 2) * s;
    ps.pan.y = size.height / 2 - (box.top + box.height / 2) * s;
    render();
  };
  return { pxPerMm, viewSize, render, zoomAt, fit, centreOn };
}

/** Mod+wheel zoom and drag pan on the viewport. */
function bindZoomPan(view: PosterView, ps: PosterState, measure: PosterMeasure): void {
  const { viewport } = view;
  const onWheel = (event: WheelEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
    const box = viewport.getBoundingClientRect();
    measure.zoomAt(ps.zoom * WHEEL_STEP ** (-pixels / 100), event.clientX - box.left, event.clientY - box.top);
  };
  let dragging: { x: number; y: number; panX: number; panY: number } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || dragging) return;
    dragging = { x: event.clientX, y: event.clientY, panX: ps.pan.x, panY: ps.pan.y };
    if (typeof event.pointerId === "number") viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    ps.pan.x = dragging.panX + event.clientX - dragging.x;
    ps.pan.y = dragging.panY + event.clientY - dragging.y;
    measure.render();
  };
  // Releasing capture fires lostpointercapture, so every way a drag ends reaches the same handler.
  const endDrag = (): void => {
    dragging = null;
  };
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) viewport.addEventListener(type, endDrag);
}

/** The draggable card-width line of the calibration panel; length() reads the current width in screen px. */
function buildCardLine(initial: number): { line: HTMLElement; handle: HTMLElement; length: () => number; setLength: (next: number) => void } {
  let length = initial;
  const handle = renderElement("div", { class: "ls-poster-card-handle", role: "slider", tabindex: "0", "aria-label": "Card width in screen pixels", "aria-valuemin": "20" });
  const line = renderElement("div", { class: "ls-poster-card-line" }, handle);
  const setLength = (next: number): void => {
    length = Math.max(20, Math.round(next));
    line.style.width = px(length);
    handle.setAttribute("aria-valuenow", String(length));
  };
  let start: { x: number; length: number } | null = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || start) return;
    start = { x: event.clientX, length };
    if (typeof event.pointerId === "number") handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (start) setLength(start.length + event.clientX - start.x);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, () => (start = null));
  handle.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setLength(length + step * (event.shiftKey ? 10 : 1));
  });
  return { line, handle, length: () => length, setLength };
}

/** The one-time card calibration: the Calibrate button opens a panel with a card-width line, Save keeps it through the store. */
function bindCalibration(view: PosterView, ps: PosterState, store: CalibrationStore, measure: PosterMeasure): void {
  let panel: HTMLElement | null = null;
  const closeCalibration = (): void => {
    panel?.remove();
    panel = null;
    view.calibrateButton.disabled = false;
  };
  const saveCalibration = (length: number, save: HTMLButtonElement): void => {
    const next = calibrationFromCard(length, new Date());
    save.disabled = true;
    void store.save(next).then(
      () => {
        if (ps.destroyed) return;
        ps.calibration = next;
        closeCalibration();
        measure.render();
      },
      () => {
        save.disabled = false;
      },
    );
  };
  const openCalibration = (): void => {
    if (panel) return;
    const card = buildCardLine(Math.round(measure.pxPerMm() * CARD_MM));
    const save = renderElement("button", { type: "button", class: "ls-poster-calibrate-save", text: "Save" });
    const cancel = renderElement("button", { type: "button", class: "ls-poster-calibrate-cancel", text: "Cancel" });
    save.addEventListener("click", () => saveCalibration(card.length(), save));
    cancel.addEventListener("click", closeCalibration);
    panel = renderElement("div", { class: "ls-poster-calibrate", role: "group", "aria-label": "Calibration" },
      renderElement("p", { text: "Drag the line to the width of a bank card (85.6 mm)" }), card.line, save, cancel);
    view.tools.after(panel);
    card.setLength(card.length());
    view.calibrateButton.disabled = true;
    card.handle.focus();
  };
  view.calibrateButton.addEventListener("click", openCalibration);
}

/** Marks each small-text leaf on the canvas, replacing the previous markers. */
function drawSmallMarkers(canvasBox: HTMLElement, found: Array<SmallTextFlag & { rect: CanvasRect }>): void {
  canvasBox.querySelectorAll(".ls-poster-marker").forEach((marker) => marker.remove());
  found.forEach((flag, index) => {
    const marker = renderElement("div", { class: "ls-poster-marker", "data-poster-marker": String(index), title: `${flag.pt} pt` });
    marker.style.left = px(flag.rect.left);
    marker.style.top = px(flag.rect.top);
    marker.style.width = px(flag.rect.width);
    marker.style.height = px(flag.rect.height);
    canvasBox.append(marker);
  });
}

/** Lists the small-text leaves in the aside (a click selects the leaf) and marks them on the canvas. */
function showSmallText(view: PosterView, ps: PosterState, thresholdPt: number, onSelectLeaf: PosterPreviewOptions["onSelectLeaf"], found: Array<SmallTextFlag & { rect: CanvasRect }>): void {
  ps.flags = found.map(({ block, leaf, pt, text }) => ({ block, leaf, pt, text }));
  view.listHeading.textContent = found.length ? `Text below ${thresholdPt} pt` : `No text below ${thresholdPt} pt`;
  view.list.replaceChildren(...found.map((flag) => {
    const entry = renderElement("button", { type: "button", class: "ls-poster-small-entry", text: `${flag.pt} pt: ${flag.text.slice(0, LIST_TEXT_CHARS)}` });
    entry.addEventListener("click", () => onSelectLeaf?.(flag.block, flag.leaf));
    return renderElement("li", {}, entry);
  }));
  drawSmallMarkers(view.canvasBox, found);
}

const sideMm = (value: number, unit: DeckSize["unit"]): number => (unit === "mm" ? value : unit === "in" ? value * 25.4 : (value / 96) * 25.4);

/** The poster content of a deck: one deck frame of the poster, its text leaves measured through computed styles, its leaves and images for the print check. */
function deckPosterContent(options: PosterPreviewOptions, size: DeckSize): PosterContent {
  const canvas = deckCanvasPx(size);
  return {
    canvas,
    thresholdPt: smallTextThresholdPt(size),
    mount: (canvasBox) => {
      const frame = mountDeckFrame(canvasBox, { html: options.html, theme: options.theme, slide: 0, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}) });
      frame.frame.width = String(canvas.width);
      frame.frame.height = String(canvas.height);
      const page = { width: sideMm(size.w, size.unit), height: sideMm(size.h, size.unit) };
      return { ready: frame.ready.then(() => undefined), smallText: (threshold) => findSmallText(frame, threshold), printInput: () => framePrintInput(frame, page), destroy: () => frame.destroy() };
    },
  };
}

/** Opens the poster preview of a deck in host; refuses a talk. Awaits the stored calibration before the first render. */
export async function openPosterPreview(host: HTMLElement, options: PosterPreviewOptions): Promise<PosterPreviewController> {
  const model = parseDeck(options.html).model;
  if (!model || model.kind !== "poster" || !model.size) throw new Error("Poster preview needs a poster");
  const { html: _html, theme: _theme, resolveAsset: _resolve, loadMath: _math, ...rest } = options;
  return openContentPosterPreview(host, { ...rest, content: deckPosterContent(options, model.size) });
}

/** Opens the poster preview of any poster content (a deck, a PDF page) in host. Awaits the stored calibration before the first render. */
export async function openContentPosterPreview(host: HTMLElement, options: ContentPosterPreviewOptions): Promise<PosterPreviewController> {
  const { canvas, thresholdPt } = options.content;
  const ps: PosterState = { calibration: await options.store.load(), unit: options.unit ?? "mm", zoom: 1, pan: { x: 0, y: 0 }, destroyed: false, flags: [], issues: [] };
  const view = buildPosterView(host, canvas, ps.unit, (next) => controller.setUnit(next), String(++previewCount));
  const poster = options.content.mount(view.canvasBox);
  const measure = createMeasure(host, view, canvas, ps);
  bindZoomPan(view, ps, measure);
  bindCalibration(view, ps, options.store, measure);
  const win = host.ownerDocument.defaultView;
  win?.addEventListener("resize", measure.render);

  const controller: PosterPreviewController = {
    zoom: () => ps.zoom,
    setZoom: (next) => {
      const size = measure.viewSize();
      measure.zoomAt(next, size.width / 2, size.height / 2);
    },
    setUnit: (next) => {
      ps.unit = next;
      measure.render();
    },
    smallText: () => ps.flags.map((flag) => ({ ...flag })),
    printIssues: () => ps.issues.map((issue) => ({ ...issue, box: { ...issue.box } })),
    calibrated: () => ps.calibration !== undefined,
    destroy: () => {
      if (ps.destroyed) return;
      ps.destroyed = true;
      win?.removeEventListener("resize", measure.render);
      poster.destroy();
      view.root.remove();
    },
  };

  measure.fit();
  await poster.ready;
  if (ps.destroyed) return controller;
  showSmallText(view, ps, thresholdPt, options.onSelectLeaf, poster.smallText(thresholdPt));
  if (poster.printInput) {
    const input = poster.printInput();
    ps.issues = checkPosterPrint(input);
    showPrintCheck(view.aside, view.canvasBox, ps.issues, canvas.width / input.page.width, measure.centreOn);
  }
  return controller;
}
