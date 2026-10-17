// Draws the paper's positioned highlights over their rendered pages.
import type { Annotation, AnnotationPosition } from "../../../model/index.js";
import type { ReaderContext } from "../session/index.js";
import { pageFrame } from "./pageFrame.js";
import { textBoxes } from "./textRects.js";

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
    const frame = pageFrame(page);
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
