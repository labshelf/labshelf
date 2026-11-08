// Print check of the poster preview: the HTML frame measured into a PrintCheckInput (mm), and the Print check list in the aside with its
// markers on the canvas (low-DPI images and items in the safe margin).
import { renderElement } from "../../ui/dom/index.js";
import { describePrintIssue, type PrintBox, type PrintCheckInput, type PrintImage, type PrintIssue, type PrintItem } from "../deckPrintCheck.js";
import type { DeckFrame } from "./deckFrame.js";
import type { CanvasRect } from "./openPosterPreview.js";

/** The frame is drawn at 96 px per inch of print (deckCanvasPx). */
const MM_PER_PX = 25.4 / 96;

function boxMm(rect: { left: number; top: number; width: number; height: number }): PrintBox {
  return { left: rect.left * MM_PER_PX, top: rect.top * MM_PER_PX, width: rect.width * MM_PER_PX, height: rect.height * MM_PER_PX };
}

/** An SVG image (by extension, query and hash ignored, or an SVG data URL) has no pixel resolution to check. */
function isSvgSource(src: string): boolean {
  const lower = src.trim().toLowerCase();
  if (lower.startsWith("data:")) return lower.startsWith("data:image/svg");
  return /\.svg$/.test(lower.replace(/[?#].*$/, ""));
}

/** The id of the innermost frame block whose element contains node, else ''. */
function blockOf(ids: ReadonlySet<string>, node: Element): string {
  for (let at = node.parentElement?.closest("[data-block]"); at; at = at.parentElement?.closest("[data-block]")) {
    const id = at.getAttribute("data-block") ?? "";
    if (ids.has(id)) return id;
  }
  return "";
}

/** The print check input of an HTML poster frame: its text leaves and raster images, boxes in mm from the page's top left. */
export function framePrintInput(frame: DeckFrame, page: { width: number; height: number }): PrintCheckInput {
  const texts: PrintItem[] = [];
  for (const { block, index, element } of frame.leaves()) {
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) continue;
    texts.push({ box: boxMm(rect), block, index });
  }
  const images: PrintImage[] = [];
  const doc = frame.frame.contentDocument;
  if (doc) {
    const ids = new Set(frame.blocks().map(({ id }) => id));
    for (const img of Array.from(doc.querySelectorAll("img"))) {
      if (!(img.naturalWidth > 0 && img.naturalHeight > 0) || isSvgSource(img.getAttribute("src") ?? img.src ?? "")) continue;
      images.push({ box: boxMm(img.getBoundingClientRect()), pixelWidth: img.naturalWidth, pixelHeight: img.naturalHeight, block: blockOf(ids, img), index: images.length });
    }
  }
  return { page: { width: page.width, height: page.height }, texts, images };
}

const px = (value: number): string => `${value}px`;

function canvasBoxOf(box: PrintBox, pxPerMm: number): CanvasRect {
  return { left: box.left * pxPerMm, top: box.top * pxPerMm, width: box.width * pxPerMm, height: box.height * pxPerMm };
}

/** Shows the Print check section in the aside and marks the low-DPI images and margin items on the canvas, replacing its previous output. */
export function showPrintCheck(aside: HTMLElement, canvasBox: HTMLElement, issues: readonly PrintIssue[], pxPerMm: number, onFocus: (box: CanvasRect) => void): void {
  const heading = renderElement("h2", { class: "ls-poster-print-heading", text: issues.length ? "Print check" : "Print check: no issues" });
  const list = renderElement("ul", { class: "ls-poster-print-list" });
  list.replaceChildren(...issues.map((issue) => {
    const entry = renderElement("button", { type: "button", class: "ls-poster-print-entry", "data-print-kind": issue.kind, text: describePrintIssue(issue) });
    entry.addEventListener("click", () => onFocus(canvasBoxOf(issue.box, pxPerMm)));
    return renderElement("li", {}, entry);
  }));
  const section = renderElement("section", { class: "ls-poster-print", "data-print-check": true, "aria-label": "Print check" }, heading, list);
  const previous = aside.querySelector(":scope > [data-print-check]");
  if (previous) previous.replaceWith(section);
  else aside.append(section);

  canvasBox.querySelectorAll(".ls-poster-print-marker").forEach((marker) => marker.remove());
  for (const issue of issues) {
    if (issue.kind === "underfill") continue;
    const rect = canvasBoxOf(issue.box, pxPerMm);
    const marker = renderElement("div", { class: "ls-poster-print-marker", "data-print-kind": issue.kind, title: describePrintIssue(issue) });
    marker.style.left = px(rect.left);
    marker.style.top = px(rect.top);
    marker.style.width = px(rect.width);
    marker.style.height = px(rect.height);
    canvasBox.append(marker);
  }
}
