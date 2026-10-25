// Resolves what a preview reader's links and in-text citations cite, and turns it into hover cards and opens.
import type { CitationEntry, CitationQuery } from "../../../index.js";
import { type ReaderContext, DOCUMENT_REPLACED } from "../../session/index.js";
import type { PageViewportLike } from "../../navigation/index.js";
import type { HoverAnchor, PopupContent } from "../hoverAnchor.js";
import { renderCitationContent } from "./card/index.js";
import { deriveRectArea, deriveScreenArea } from "./pageAreas.js";

interface LinkAnnotationData {
  id: string;
  dest?: string | unknown[] | null;
  /** `[x0, y0, x1, y1]` in PDF user space, y growing upwards. */
  rect?: number[];
}

class LinkAnnotations {
  private readonly pages = new Map<number, Promise<LinkAnnotationData[]>>();

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.pages.clear());
  }

  async find(pageNumber: number, id: string): Promise<LinkAnnotationData | undefined> {
    return (await this.onPage(pageNumber)).find((a) => a.id === id);
  }

  private onPage(pageNumber: number): Promise<LinkAnnotationData[]> {
    let p = this.pages.get(pageNumber);
    if (!p) {
      p = this.ctx.pdfDocument.getPage(pageNumber)
        .then((page) => page.getAnnotations({ intent: "display" }))
        .then((list) => (list as Array<LinkAnnotationData & { subtype?: string }>).filter((a) => a.subtype === "Link"));
      this.pages.set(pageNumber, p);
    }
    return p;
  }
}

/** The host always answers; this only bounds the wait when the host is gone or stuck. */
export const LOOKUP_TIMEOUT_MS = 1500;

export class CitationFinder {
  private nextRequest = 1;
  private readonly waiting = new Map<number, (entries: CitationEntry[] | null) => void>();
  private readonly answers = new Map<string, Promise<CitationEntry[]>>();

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.answers.clear());
  }

  /**
   * @param cacheKey names the place for the lifetime of the open document; omit it for places that are not links.
   * @returns the entries cited at the place; empty when the host names none or does not answer in time.
   */
  lookup(query: CitationQuery, cacheKey?: string): Promise<CitationEntry[]> {
    const cached = cacheKey === undefined ? undefined : this.answers.get(cacheKey);
    if (cached) { return cached; }
    const asked = this.ask(query).then((entries) => {
      // A timeout is not an answer: the same place may be asked again.
      if (entries === null && cacheKey !== undefined) { this.answers.delete(cacheKey); }
      return entries ?? [];
    });
    if (cacheKey !== undefined) { this.answers.set(cacheKey, asked); }
    return asked;
  }

  /** Delivers the host's `citation` answer to the request that asked for it. */
  receive(request: number, entries: CitationEntry[]): void {
    const settle = this.waiting.get(request);
    this.waiting.delete(request);
    settle?.(entries);
  }

  private ask(query: CitationQuery): Promise<CitationEntry[] | null> {
    const request = this.nextRequest++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(request); resolve(null); }, LOOKUP_TIMEOUT_MS);
      this.waiting.set(request, (entries) => { clearTimeout(timer); resolve(entries); });
      this.ctx.host.post({ command: "lookupCitation", request, query });
    });
  }
}

interface PageViewLike { viewport?: PageViewportLike }

export class PreviewCitations {
  readonly lookup: CitationFinder;
  readonly annotations: LinkAnnotations;

  constructor(private readonly ctx: ReaderContext) {
    this.lookup = new CitationFinder(ctx);
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
    const area = deriveRectArea(page, annotation.rect, viewport.viewBox);
    return this.lookup.lookup({ area, link: true, ...(dest === undefined ? {} : { dest }) }, `${page}:${id}`);
  }

  /** The card for an internal link, or null when it cites no library paper. */
  async linkCard(link: HTMLElement): Promise<PopupContent | null> {
    return renderCitationContent(await this.linkEntries(link), (id, citedPage) => this.open(id, citedPage), (request) => this.ctx.host.post(request));
  }

  /** The card for text read as an in-text citation, or null when it cites no library paper. */
  async textCard(target: HoverAnchor, pageEl: HTMLElement, page: number): Promise<PopupContent | null> {
    const viewport = this.viewport(page);
    if (!this.ctx.boot.preview || !viewport) { return null; }
    const area = deriveScreenArea(page, viewport, pageEl, target.rect());
    return renderCitationContent(await this.lookup.lookup({ area, link: false }), (id, citedPage) => this.open(id, citedPage), (request) => this.ctx.host.post(request));
  }

  open(paperId: string, page?: number): void {
    this.ctx.host.post({ command: "openCitedPaper", paperId, ...(page === undefined ? {} : { page }) });
  }

  private viewport(page: number): PageViewportLike | undefined {
    return (this.ctx.pdfViewer.getPageView(page - 1) as PageViewLike | undefined)?.viewport;
  }
}
