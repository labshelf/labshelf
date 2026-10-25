/** Prepares popup content for a reference found in plain text: a cited work, or a figure, table or equation. */
import type { FloatKind, InTextRef } from "../../text/index.js";
import type { FloatResolver, CitationResolver } from "../text/index.js";
import type { ReaderContext } from "../session/index.js";
import type { PreviewCitations } from "./citations/index.js";
import type { DestPreview } from "./destPreview.js";
import type { ExplicitDest, HoverTarget, PopupContent } from "./hoverAnchor.js";
import { textContent } from "./popup.js";

const MAX_MARKER_ENTRIES = 3;
const FLOAT_TITLES: Record<FloatKind, string> = { figure: "Figure", table: "Table", equation: "Equation" };
// Hovering a caption's own label ("Figure 3.") should not pop up a picture of itself.
const SAME_PLACE_POINTS = 16;

export class ReferenceContent {
  constructor(
    private readonly ctx: ReaderContext,
    private readonly resolver: CitationResolver,
    private readonly floats: FloatResolver,
    private readonly preview: DestPreview,
    private readonly citations: PreviewCitations,
  ) {}

  async prepareText(target: HoverTarget, isCurrent: () => boolean): Promise<PopupContent | null> {
    const ref = target.ref;
    const pageEl = target.group[0]?.closest<HTMLElement>(".page");
    const pageNumber = Number(pageEl?.dataset["pageNumber"]);
    if (!ref || !pageEl || !pageNumber) { return null; }
    if (ref.kind === "float") { return this.prepareFloat(target, ref, pageEl, pageNumber, isCurrent); }
    return (await this.citations.textCard(target, pageEl, pageNumber)) ?? this.prepareCitation(ref);
  }

  private async prepareCitation(ref: Exclude<InTextRef, { kind: "float" }>): Promise<PopupContent | null> {
    const hits: Array<{ text: string; pageNumber: number; y: number }> = [];
    let missing = 0;
    if (ref.kind === "numeric") {
      for (const n of ref.numbers.slice(0, MAX_MARKER_ENTRIES)) {
        const hit = await this.resolver.entryNumbered(n);
        if (hit) { hits.push(hit); }
      }
      missing = ref.numbers.length - hits.length;
    } else {
      hits.push(...await this.resolver.entriesByAuthorYear(ref));
    }
    const first = hits[0];
    if (!first) { return null; }
    const texts = hits.map((hit) => hit.text);
    if (ref.kind === "numeric" && missing > 0 && ref.numbers.length > MAX_MARKER_ENTRIES) { texts.push(`+${missing} more`); }
    return textContent(texts, () => this.jumpTo(first.pageNumber, null, first.y));
  }

  private async prepareFloat(
    target: HoverTarget,
    ref: Extract<InTextRef, { kind: "float" }>,
    pageEl: HTMLElement,
    pageNumber: number,
    isCurrent: () => boolean,
  ): Promise<PopupContent | null> {
    const found = await this.floats.find(ref.floatKind, ref.label);
    if (!found || !isCurrent()) { return null; }
    if (found.pageNumber === pageNumber) {
      const view = this.ctx.pdfViewer.getPageView(pageNumber - 1) as { viewport?: { convertToPdfPoint(x: number, y: number): number[] } } | undefined;
      const at = target.rect();
      const pdfY = view?.viewport?.convertToPdfPoint(0, at.top + at.height / 2 - pageEl.getBoundingClientRect().top - pageEl.clientTop)[1];
      if (pdfY !== undefined && Math.abs(pdfY - found.captionY) < SAME_PLACE_POINTS) { return null; }
    }
    const canvas = await this.preview.renderRegion(found.pageNumber, found.region);
    if (!canvas) { return null; }
    return {
      title: `${FLOAT_TITLES[ref.floatKind]} ${ref.label.toUpperCase()} · Page ${found.pageNumber}`,
      body: canvas,
      copyText: null,
      jump: () => this.jumpTo(found.pageNumber, found.region.x0, found.region.yTop),
    };
  }

  /** Goes through the link service so the jump lands in the back/forward history like a followed link. */
  private jumpTo(pageNumber: number, x: number | null, y: number | null): void {
    const dest = [pageNumber - 1, { name: "XYZ" }, x, y, null] as unknown as ExplicitDest;
    void this.ctx.linkService.goToDestination(dest);
  }
}
