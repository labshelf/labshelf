// Resolves what a preview reader's links and in-text citations cite, and turns it into hover cards and opens.
import type { CitationEntry } from "../../../index.js";
import type { ReaderContext } from "../../session/index.js";
import type { PageViewportLike } from "../../navigation/index.js";
import type { HoverTarget, PopupContent } from "../hoverTarget.js";
import { citationContent } from "./card/index.js";
import { CitationLookup } from "./citationLookup.js";
import { LinkAnnotations } from "./linkAnnotations.js";
import { rectArea, screenArea } from "./pageAreas.js";

interface PageViewLike { viewport?: PageViewportLike }

export class PreviewCitations {
  readonly lookup: CitationLookup;
  readonly annotations: LinkAnnotations;

  constructor(private readonly ctx: ReaderContext) {
    this.lookup = new CitationLookup(ctx);
    this.annotations = new LinkAnnotations(ctx);
  }

  /**
   * @returns the entries an internal link cites; always empty in a reader that is not a build preview.
   */
  async linkEntries(link: HTMLElement): Promise<CitationEntry[]> {
    const page = Number(link.closest<HTMLElement>(".page")?.dataset["pageNumber"]);
    const id = link.dataset["annotationId"];
    if (!this.ctx.boot.preview || !page || !id) { return []; }
    const annotation = await this.annotations.find(page, id);
    const viewport = this.viewport(page);
    if (!annotation?.rect || !viewport) { return []; }
    const dest = typeof annotation.dest === "string" ? annotation.dest : undefined;
    const area = rectArea(page, annotation.rect, viewport.viewBox);
    return this.lookup.lookup({ area, link: true, ...(dest === undefined ? {} : { dest }) }, `${page}:${id}`);
  }

  /** The card for an internal link, or null when it cites no library paper. */
  async linkCard(link: HTMLElement): Promise<PopupContent | null> {
    return citationContent(await this.linkEntries(link), (id, citedPage) => this.open(id, citedPage), (request) => this.ctx.host.post(request));
  }

  /** The card for text read as an in-text citation, or null when it cites no library paper. */
  async textCard(target: HoverTarget, pageEl: HTMLElement, page: number): Promise<PopupContent | null> {
    const viewport = this.viewport(page);
    if (!this.ctx.boot.preview || !viewport) { return null; }
    const area = screenArea(page, viewport, pageEl, target.rect());
    return citationContent(await this.lookup.lookup({ area, link: false }), (id, citedPage) => this.open(id, citedPage), (request) => this.ctx.host.post(request));
  }

  open(paperId: string, page?: number): void {
    this.ctx.host.post({ command: "openCitedPaper", paperId, ...(page === undefined ? {} : { page }) });
  }

  private viewport(page: number): PageViewportLike | undefined {
    return (this.ctx.pdfViewer.getPageView(page - 1) as PageViewLike | undefined)?.viewport;
  }
}
