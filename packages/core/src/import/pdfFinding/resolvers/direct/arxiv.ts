/** Builds arXiv's canonical PDF address, a fixed function of the id, so no lookup is needed. */
import type { PdfResolver } from "../../types.js";

export const arxivResolver: PdfResolver = {
  name: "arxiv",
  async resolve(ctx) {
    return ctx.arxivId ? [`https://arxiv.org/pdf/${ctx.arxivId}`] : [];
  },
};
