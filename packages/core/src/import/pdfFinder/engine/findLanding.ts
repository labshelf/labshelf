/** Opens the article page a DOI resolves to, learning its URL and proposing the PDF links it offers. */
import { fetchLandingPage } from "../../landing/index.js";
import type { PdfFetchOptions, PdfResolver } from "../pdfResolver.js";

// The lookup cap cuts it first; this only bounds a host that ignores the abort.
const PAGE_TIMEOUT_MS = 10_000;

/** A resolver that reads the DOI's landing page with the download's cookies and headers, since publishers gate it like the PDF. */
export function landingLookup(settings: Pick<PdfFetchOptions, "credentials" | "headers">): PdfResolver {
  return {
    name: "landing",
    async resolve(ctx, env) {
      if (ctx.landingUrl || !ctx.doi) return [];
      const facts = await fetchLandingPage(`https://doi.org/${ctx.doi}`, {
        fetch: env.fetch,
        timeoutMs: PAGE_TIMEOUT_MS,
        logger: env.logger,
        ...(settings.credentials ? { credentials: settings.credentials } : {}),
        ...(settings.headers ? { headers: settings.headers } : {}),
      });
      if (!facts) return [];
      // Publisher rules key some platforms by the landing URL, and downloads send it as Referer.
      ctx.landingUrl = facts.pageUrl;
      return facts.pdfCandidates.map((c) => c.url);
    },
  };
}
