/** Proposes the PDF links the page itself offered: the tab when it is a PDF, an embedded viewer, citation_pdf_url, rel=alternate, anchors that name the paper. */
import type { PdfResolver } from "../../types.js";

export const pageHintResolver: PdfResolver = {
  name: "page",
  async resolve(ctx) {
    return ctx.pageCandidates.map((c) => c.url);
  },
};
