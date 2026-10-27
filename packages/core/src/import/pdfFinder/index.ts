/** Exports PDF finding's public API: the resolver chain, the search every app runs for an identified paper, and the download rule. */
export type {
  CustomResolver, FetchedPdf, FetchOutcome, InTabAnswer, LibraryProxy, PdfAttempt, PdfFetchOptions, PdfResolver, ResolveContext, ResolvedPdf, TabPort,
} from "./finder.js";
export { resolvePdf, createResolveInput, findPaperPdf } from "./finder.js";
export type { PdfSearch } from "./finder.js";
export { isCustomResolverTemplate } from "./openAccess.js";
export { isPreprintServerUrl } from "./matching.js";
export { isScholarlyHost } from "./rules.js";
export { fetchPdf, isBotCheck, isSupplementaryUrl, isWallPage, extractNextHopsFromHtml, createProxiedUrl, deriveProxyKind, type ProxyKind } from "./client.js";
