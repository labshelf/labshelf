// Draws the paper's positioned highlights over their rendered pages.
import type { Annotation, AnnotationPosition } from "../../../model/index.js";
import type { ReaderContext } from "../session/index.js";
import { derivePageFrame, deriveBoxInPage, type PageFrame } from "./derivePageFrame.js";

interface CharAt {
  node: Text;
  offset: number;
}

/**
 * Looks for `content` in the text-layer text that overlaps `box`, ignoring whitespace, because line breaks and
 * spacing in the text layer rarely match the copied selection.
 * @returns one box per line of the matched text, or null when the text layer is missing or does not contain it.
 */
function textBoxes(page: HTMLElement, frame: PageFrame, content: string, box: AnnotationPosition): AnnotationPosition[] | null {
  const needle = content.replace(/\s+/g, "");
  const textLayer = page.querySelector(".textLayer");
  if (!needle || !textLayer) { return null; }
  const chars = charsInBox(textLayer, frame, box);
  const start = chars.map((c) => c.node.data[c.offset]).join("").indexOf(needle);
  if (start < 0) { return null; }
  const first = chars[start]!;
  const last = chars[start + needle.length - 1]!;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  const boxes = [...range.getClientRects()].map((r) => deriveBoxInPage(r, frame)).filter((b): b is AnnotationPosition => b !== null);
  return boxes.length > 0 ? boxes : null;
}

/** Every non-whitespace character of the text nodes whose element overlaps the box, in document order. */
function charsInBox(textLayer: Element, frame: PageFrame, box: AnnotationPosition): CharAt[] {
  const left = frame.left + box.x * frame.width;
  const top = frame.top + box.y * frame.height;
  const right = left + box.width * frame.width;
  const bottom = top + box.height * frame.height;
  const chars: CharAt[] = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const r = node.parentElement?.getBoundingClientRect();
    if (!r || r.right <= left || r.left >= right || r.bottom <= top || r.top >= bottom) { continue; }
    for (let offset = 0; offset < node.data.length; offset++) {
      if (!/\s/.test(node.data[offset]!)) { chars.push({ node, offset }); }
    }
  }
  return chars;
}

const LAYER_CLASS = "rd-hl-layer";

export class PageHighlights {
  private byPage = new Map<number, Annotation[]>();

  constructor(ctx: Pick<ReaderContext, "eventBus">) {
    // PLATFORM: pdf.js drops unknown page children on every re-render (zoom, scrolling back into view) and rebuilds the text layer.
    ctx.eventBus.on("textlayerrendered", ({ pageNumber }: { pageNumber: number }) => this.paintPage(pageNumber));
  }

  /** Replaces the drawn highlights; annotations without a position are not drawn. */
  show(annotations: readonly Annotation[]): void {
    const pages = new Set(this.byPage.keys());
    this.byPage = new Map();
    for (const ann of annotations) {
      if (!ann.position) { continue; }
      this.byPage.set(ann.pageNumber, [...(this.byPage.get(ann.pageNumber) ?? []), ann]);
      pages.add(ann.pageNumber);
    }
    for (const page of pages) { this.paintPage(page); }
  }

  private paintPage(pageNumber: number): void {
    const page = document.querySelector<HTMLElement>(`#viewer .page[data-page-number="${pageNumber}"]`);
    if (!page) { return; }
    page.querySelector(`.${LAYER_CLASS}`)?.remove();
    const annotations = this.byPage.get(pageNumber);
    if (!annotations) { return; }
    const layer = document.createElement("div");
    layer.className = LAYER_CLASS;
    const frame = derivePageFrame(page);
    for (const ann of annotations) {
      const box = ann.position!;
      const boxes = (frame && textBoxes(page, frame, ann.content, box)) ?? [box];
      for (const b of boxes) { layer.append(overlay(b, ann)); }
    }
    // Below the text layer, so selecting over a highlight still works.
    page.insertBefore(layer, page.querySelector(".textLayer"));
  }
}

/** Positioned in percent of the page, so the overlay keeps its place while pdf.js scales the page before re-rendering it. */
function overlay(box: AnnotationPosition, ann: Annotation): HTMLElement {
  const div = document.createElement("div");
  div.className = `rd-hl rd-color-${ann.color ?? "note"}`;
  div.dataset["annotationId"] = ann.id;
  div.style.left = `${box.x * 100}%`;
  div.style.top = `${box.y * 100}%`;
  div.style.width = `${box.width * 100}%`;
  div.style.height = `${box.height * 100}%`;
  return div;
}
