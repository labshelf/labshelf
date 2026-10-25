// Proposes the publisher's own PDF URLs that the rule table builds from the landing page and the DOI.
import { listPdfUrlsForDoi, listPdfUrlsForLanding } from "../rules/index.js";
import type { PdfResolver } from "../pdfResolver.js";

// Without institutional access these URLs land on a login page, which the downloader classifies as "login".
export const publisherResolver: PdfResolver = {
  name: "publisher",
  async resolve(ctx) {
    return [
      ...(ctx.landingUrl ? listPdfUrlsForLanding(ctx.landingUrl) : []),
      ...(ctx.doi ? listPdfUrlsForDoi(ctx.doi) : []),
    ];
  },
};
