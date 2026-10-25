/** Exports PDF finding's public API: the resolver chain, the search every app runs for an identified paper, and the download rule. */
export type {
  CustomResolver, FetchedPdf, FetchOutcome, InTabAnswer, LibraryProxy, PdfAttempt, PdfFetchOptions, PdfResolver, ResolveContext, ResolvedPdf, TabPort,
} from "./pdfResolver.js";
export { resolvePdf } from "./resolvePdf.js";
export { isCustomResolverTemplate, isPreprintServerUrl } from "./resolvers/index.js";
export { isScholarlyHost } from "./rules/index.js";
export { makeResolveContext } from "./resolveContext.js";
export { findPaperPdf } from "./findPaperPdf.js";
export type { PdfSearch } from "./findPaperPdf.js";
export { fetchPdf, isBotCheck, isSupplementaryUrl, isWallPage, nextHopsFromHtml, proxiedUrl, proxyKind, type ProxyKind } from "./client/index.js";
