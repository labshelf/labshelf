/** Exports paper resolution's public API: merging page facts with registry records, settling a page's paper, library matching, same-work checks and matching a PDF to a paper. */
export { PAGE_TRUST, resolveMetadata, withAbstract } from "./resolveMetadata.js";
export type { MetadataOrigin } from "./resolveMetadata.js";
export { surname } from "./titleAgreement.js";
export { sameWork, wordBigramDice } from "./samePaper.js";
export type { SameWorkOptions, WorkRef } from "./samePaper.js";
export { findInLibrary } from "./libraryMatch.js";
export { resolvePagePaper } from "./pagePaper.js";
export type { PagePaper } from "./pagePaper.js";
export { idsFromRecord } from "./paperIdentifiers.js";
export { metadataFromRecord } from "./paperMetadata.js";
export { matchPdfToPaper } from "./matchPdfToPaper.js";
export type { MatchablePaper, PdfToMatch } from "./matchPdfToPaper.js";
