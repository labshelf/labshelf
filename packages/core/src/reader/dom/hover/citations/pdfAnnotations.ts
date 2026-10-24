// Reads the link annotations of each page once per open document.
import { DOCUMENT_REPLACED, type ReaderContext } from "../../session/index.js";

export interface LinkAnnotationData {
  id: string;
  dest?: string | unknown[] | null;
  /** `[x0, y0, x1, y1]` in PDF user space, y growing upwards. */
  rect?: number[];
}

export class LinkAnnotations {
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
