// Poster preview (D10): the whole poster in one deck frame with Mod+wheel zoom, drag pan, mm or in rulers, a one-time card calibration
// kept through a CalibrationStore, and the text leaves below the small-text threshold listed and marked on the canvas.
import { renderElement } from "../../ui/dom/index.js";
import { parseDeck } from "../deckParse.js";
import { deckCanvasPx } from "../deckSizes.js";
import { calibrationFromCard, clampPosterZoom, rulerTicks, smallTextThresholdPt, type CalibrationStore, type RulerUnit } from "../present/posterMeasure.js";
import { mountDeckFrame, type DeckFrame, type DeckFrameOptions } from "./deckFrame.js";

export interface PosterPreviewOptions { html: string; theme: string; store: CalibrationStore; resolveAsset: (path: string) => Promise<string>; loadMath?: DeckFrameOptions["loadMath"]; unit?: RulerUnit; onSelectLeaf?: (block: string, leaf: number) => void }

export interface SmallTextFlag { block: string; leaf: number; pt: number; text: string }

export interface PosterPreviewController { zoom(): number; setZoom(zoom: number): void; setUnit(unit: RulerUnit): void; smallText(): SmallTextFlag[]; calibrated(): boolean; destroy(): void }

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
function findSmallText(frame: DeckFrame, thresholdPt: number): Array<SmallTextFlag & { rect: DOMRect }> {
  const view = frame.frame.contentWindow;
  if (!view) return [];
  return frame.leaves().flatMap(({ block, index, element }) => {
    const pt = Number.parseFloat(view.getComputedStyle(element).fontSize) * 0.75;
    if (!Number.isFinite(pt) || pt >= thresholdPt) return [];
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return [{ block, leaf: index, pt: roundPt(pt), text, rect: element.getBoundingClientRect() }];
  });
}

/** Opens the poster preview of a deck in host; refuses a talk. Awaits the stored calibration before the first render. */
export async function openPosterPreview(host: HTMLElement, options: PosterPreviewOptions): Promise<PosterPreviewController> {
  const model = parseDeck(options.html).model;
  if (!model || model.kind !== "poster" || !model.size) throw new Error("Poster preview needs a poster");
  const canvas = deckCanvasPx(model.size);
  const thresholdPt = smallTextThresholdPt(model.size);
  let calibration = await options.store.load();
  let unit: RulerUnit = options.unit ?? "mm";
  let zoom = 1;
  const pan = { x: 0, y: 0 };
  let destroyed = false;
  let flags: SmallTextFlag[] = [];

  const id = String(++previewCount);
  // The fixed layout is in deck-editor.css; what changes is written through element.style, which a webview CSP allows.
  const root = renderElement("div", { class: "ls-poster-preview", "data-poster-preview": id, role: "region", "aria-label": "Poster preview" });
  host.append(root);

  const unitButton = (value: RulerUnit): HTMLButtonElement => {
    const b = renderElement("button", { type: "button", class: "ls-poster-unit", text: value, "aria-pressed": String(value === unit), title: value === "mm" ? "Ruler in millimetres" : "Ruler in inches" });
    b.addEventListener("click", () => controller.setUnit(value));
    return b;
  };
  const unitButtons = { mm: unitButton("mm"), in: unitButton("in") };
  const status = renderElement("span", { class: "ls-poster-calibration", role: "status" });
  const zoomLabel = renderElement("span", { class: "ls-poster-zoom", "aria-label": "Zoom" });
  const calibrateButton = renderElement("button", { type: "button", class: "ls-poster-calibrate-open", text: "Calibrate" });
  const tools = renderElement("div", { class: "ls-poster-tools", role: "toolbar", "aria-label": "Ruler" },
    renderElement("span", { class: "ls-poster-units", role: "group", "aria-label": "Ruler unit" }, unitButtons.mm, unitButtons.in), status, calibrateButton, zoomLabel);

  const topRuler = svgElement(host.ownerDocument, "svg", { class: "ls-poster-ruler-top", "aria-hidden": "true" });
  const leftRuler = svgElement(host.ownerDocument, "svg", { class: "ls-poster-ruler-left", "aria-hidden": "true" });
  const canvasBox = renderElement("div", { class: "ls-poster-canvas" });
  canvasBox.style.width = px(canvas.width);
  canvasBox.style.height = px(canvas.height);
  const viewport = renderElement("div", { class: "ls-poster-viewport" }, canvasBox);
  const stage = renderElement("div", { class: "ls-poster-stage" }, topRuler, leftRuler, viewport);
  const listHeading = renderElement("h2", { class: "ls-poster-small-heading" });
  const list = renderElement("ul", { class: "ls-poster-small-list" });
  const aside = renderElement("aside", { class: "ls-poster-small", "data-small-text": true, "aria-label": "Small text" }, listHeading, list);
  root.append(tools, renderElement("div", { class: "ls-poster-body" }, stage, aside));

  const frame = mountDeckFrame(canvasBox, { html: options.html, theme: options.theme, slide: 0, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}) });
  frame.frame.width = String(canvas.width);
  frame.frame.height = String(canvas.height);

  const pxPerMm = (): number => calibration?.pxPerMm ?? DEFAULT_PX_PER_MM;
  /** Screen px per canvas px: zoom 1 is real size, one mm spanning pxPerMm screen px. */
  const scale = (): number => (zoom * pxPerMm()) / DEFAULT_PX_PER_MM;
  /** The viewport size; before layout gives it one, the host's size less the rulers. */
  const viewSize = (): { width: number; height: number } => ({
    width: viewport.clientWidth || Math.max(0, host.clientWidth - RULER),
    height: viewport.clientHeight || Math.max(0, host.clientHeight - RULER),
  });

  const render = (): void => {
    if (destroyed) return;
    const s = scale();
    const view = viewSize();
    canvasBox.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${s})`;
    drawRuler(topRuler, true, canvas.width, view.width, unit, s, pan.x);
    drawRuler(leftRuler, false, canvas.height, view.height, unit, s, pan.y);
    for (const value of ["mm", "in"] as const) unitButtons[value].setAttribute("aria-pressed", String(value === unit));
    status.textContent = calibration ? `Calibrated ${calibration.measuredAt.slice(0, 10)}` : "Not calibrated";
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };

  /** Sets the zoom keeping the viewport point (x, y) over the same canvas point. */
  const zoomAt = (next: number, x: number, y: number): void => {
    const before = scale();
    zoom = clampPosterZoom(next);
    const ratio = scale() / before;
    pan.x = x - (x - pan.x) * ratio;
    pan.y = y - (y - pan.y) * ratio;
    render();
  };

  const fit = (): void => {
    const view = viewSize();
    const fitScale = Math.min(view.width / canvas.width, view.height / canvas.height);
    zoom = clampPosterZoom(fitScale > 0 ? (fitScale * DEFAULT_PX_PER_MM) / pxPerMm() : 1);
    const s = scale();
    pan.x = (view.width - canvas.width * s) / 2;
    pan.y = (view.height - canvas.height * s) / 2;
    render();
  };

  const onWheel = (event: WheelEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
    const box = viewport.getBoundingClientRect();
    zoomAt(zoom * WHEEL_STEP ** (-pixels / 100), event.clientX - box.left, event.clientY - box.top);
  };
  let dragging: { x: number; y: number; panX: number; panY: number } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || dragging) return;
    dragging = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    if (typeof event.pointerId === "number") viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    pan.x = dragging.panX + event.clientX - dragging.x;
    pan.y = dragging.panY + event.clientY - dragging.y;
    render();
  };
  // Releasing capture fires lostpointercapture, so every way a drag ends reaches the same handler.
  const endDrag = (): void => {
    dragging = null;
  };
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) viewport.addEventListener(type, endDrag);
  const win = host.ownerDocument.defaultView;
  win?.addEventListener("resize", render);

  let panel: HTMLElement | null = null;
  const closeCalibration = (): void => {
    panel?.remove();
    panel = null;
    calibrateButton.disabled = false;
  };
  const openCalibration = (): void => {
    if (panel) return;
    let length = Math.round(pxPerMm() * CARD_MM);
    const setLength = (next: number): void => {
      length = Math.max(20, Math.round(next));
      line.style.width = px(length);
      handle.setAttribute("aria-valuenow", String(length));
    };
    const handle = renderElement("div", { class: "ls-poster-card-handle", role: "slider", tabindex: "0", "aria-label": "Card width in screen pixels", "aria-valuemin": "20" });
    const line = renderElement("div", { class: "ls-poster-card-line" }, handle);
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
    const save = renderElement("button", { type: "button", class: "ls-poster-calibrate-save", text: "Save" });
    const cancel = renderElement("button", { type: "button", class: "ls-poster-calibrate-cancel", text: "Cancel" });
    save.addEventListener("click", () => {
      const next = calibrationFromCard(length, new Date());
      save.disabled = true;
      void options.store.save(next).then(
        () => {
          if (destroyed) return;
          calibration = next;
          closeCalibration();
          render();
        },
        () => {
          save.disabled = false;
        },
      );
    });
    cancel.addEventListener("click", closeCalibration);
    panel = renderElement("div", { class: "ls-poster-calibrate", role: "group", "aria-label": "Calibration" },
      renderElement("p", { text: "Drag the line to the width of a bank card (85.6 mm)" }), line, save, cancel);
    tools.after(panel);
    setLength(length);
    calibrateButton.disabled = true;
    handle.focus();
  };
  calibrateButton.addEventListener("click", openCalibration);

  const showSmallText = (found: Array<SmallTextFlag & { rect: DOMRect }>): void => {
    flags = found.map(({ block, leaf, pt, text }) => ({ block, leaf, pt, text }));
    listHeading.textContent = found.length ? `Text below ${thresholdPt} pt` : `No text below ${thresholdPt} pt`;
    list.replaceChildren(...found.map((flag) => {
      const entry = renderElement("button", { type: "button", class: "ls-poster-small-entry", text: `${flag.pt} pt: ${flag.text.slice(0, LIST_TEXT_CHARS)}` });
      entry.addEventListener("click", () => options.onSelectLeaf?.(flag.block, flag.leaf));
      return renderElement("li", {}, entry);
    }));
    canvasBox.querySelectorAll(".ls-poster-marker").forEach((marker) => marker.remove());
    found.forEach((flag, index) => {
      const marker = renderElement("div", { class: "ls-poster-marker", "data-poster-marker": String(index), title: `${flag.pt} pt` });
      marker.style.left = px(flag.rect.left);
      marker.style.top = px(flag.rect.top);
      marker.style.width = px(flag.rect.width);
      marker.style.height = px(flag.rect.height);
      canvasBox.append(marker);
    });
  };

  const controller: PosterPreviewController = {
    zoom: () => zoom,
    setZoom: (next) => {
      const view = viewSize();
      zoomAt(next, view.width / 2, view.height / 2);
    },
    setUnit: (next) => {
      unit = next;
      render();
    },
    smallText: () => flags.map((flag) => ({ ...flag })),
    calibrated: () => calibration !== undefined,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      win?.removeEventListener("resize", render);
      frame.destroy();
      root.remove();
    },
  };

  fit();
  await frame.ready;
  if (!destroyed) showSmallText(findSmallText(frame, thresholdPt));
  return controller;
}
