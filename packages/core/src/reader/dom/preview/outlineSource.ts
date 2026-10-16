// Gives the preview chrome the open document's outline, its page positions and the jump to an entry.
import { flattenOutline, type OutlineRow, type RawOutlineNode } from "../../logic/index.js";
import type { ReaderContext } from "../session/index.js";
import { resolveOutlinePages } from "../sidebar/outlinePages.js";
import type { PreviewOutlineSource } from "./mountPreviewChrome.js";

type Destination = Parameters<ReaderContext["linkService"]["goToDestination"]>[0];

export function previewOutlineSource(ctx: ReaderContext): PreviewOutlineSource {
  return {
    async load() {
      const doc = ctx.pdfDocument;
      let raw: RawOutlineNode[] | null = null;
      try {
        raw = (await doc.getOutline()) as RawOutlineNode[] | null;
      } catch (err) {
        console.warn("LabShelf reader: could not read the PDF outline", err);
      }
      const rows = flattenOutline(raw);
      return { rows, pages: await resolveOutlinePages(doc, rows, () => doc === ctx.pdfDocument) };
    },
    currentPage: () => ctx.pdfViewer.currentPageNumber,
    onPageChange: (fn) => ctx.eventBus.on("pagechanging", fn),
    jump: (row: OutlineRow) => { if (row.dest) { void ctx.linkService.goToDestination(row.dest as Destination); } },
  };
}
