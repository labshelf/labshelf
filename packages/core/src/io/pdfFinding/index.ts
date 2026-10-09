/** Public API of PDF finding: the resolver chain, the context every app builds for it, and the download rule. */
export type {
  FetchedPdf, InTabAnswer, PdfAttempt, PdfFetchOptions, PdfResolver, ResolveContext, ResolvedPdf, TabPort,
} from "./types.js";
export { resolvePdf } from "./resolvePdf.js";
export { makeResolveContext } from "./resolveContext.js";
export type { ResolveOptions } from "./resolveContext.js";
export { fetchPdf, isBotCheck, isPdfBytes, nextHopsFromHtml } from "./download/index.js";
