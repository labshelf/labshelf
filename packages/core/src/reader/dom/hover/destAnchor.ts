/** Builds hover targets for PDF link annotations: finds the link under the pointer and prepares the popup for its destination. */
import { destPoint } from "../../index.js";
import type { CitationResolver } from "../text/index.js";
import type { PreviewCitations } from "./citations/index.js";
import type { ReaderContext } from "../session/index.js";
import type { DestPreview } from "./destPreview.js";
import type { ExplicitDest, HoverTarget, PopupContent } from "./hoverAnchor.js";
import { textContent } from "./popup.js";

const LINK_SELECTOR = "section.linkAnnotation[data-internal-link]";

/**
 * @returns the internal link annotation the event is on, or null.
 */
export function findLink(e: MouseEvent): HTMLElement | null {
  return (e.target as Element).closest?.<HTMLElement>(LINK_SELECTOR) ?? null;
}

export function linkHoverTarget(link: HTMLElement): HoverTarget {
  return { group: [link], ref: null, rect: () => link.getBoundingClientRect() };
}

export class LinkContent {
  constructor(
    private readonly ctx: ReaderContext,
    private readonly resolver: CitationResolver,
    private readonly preview: DestPreview,
    private readonly citations: PreviewCitations,
  ) {}

  async prepare(link: HTMLElement, isCurrent: () => boolean): Promise<PopupContent | null> {
    const pageNumber = Number(link.closest<HTMLElement>(".page")?.dataset["pageNumber"]);
    const id = link.dataset["annotationId"];
    if (!pageNumber || !id) { return null; }
    const dest = (await this.citations.annotations.find(pageNumber, id))?.dest;
    if (!dest) { return null; }
    const card = await this.citations.linkCard(link);
    if (card) { return card; }
    const doc = this.ctx.pdfDocument;
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) { return null; }
    const ref = explicit[0] as unknown;
    const targetPage = ref && typeof ref === "object"
      ? (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1
      : typeof ref === "number" ? ref + 1 : 0;
    if (!targetPage || !isCurrent()) { return null; }
    const point = destPoint(explicit) ?? { x: null, y: null, kind: "Fit" };
    const jump = (): void => { void this.ctx.linkService.goToDestination(dest as ExplicitDest); };

    if (point.y !== null && await this.resolver.isInReferences(targetPage, point.y, point.x)) {
      const text = await this.resolver.entryAt(targetPage, point.y, point.x);
      if (text) { return textContent([text], jump); }
      // No reliable entry boundaries: a picture of the destination is never wrong, extracted text could be.
    }
    if (!isCurrent()) { return null; }
    const canvas = await this.preview.render(targetPage, point.x, point.y);
    return canvas ? { title: `Page ${targetPage}`, body: canvas, copyText: null, jump } : null;
  }
}
