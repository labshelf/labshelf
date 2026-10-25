/** Exports paper resolution's public API: merging page facts with registry records, settling a page's paper, library matching, same-work checks and matching a PDF to a paper. */
export { PAGE_TRUST, resolveMetadata, withAbstract } from "./resolveMetadata.js";
export type { MetadataOrigin } from "./resolveMetadata.js";
export { deriveSurname } from "./titleAgreement.js";
export { isSameWork, deriveWordBigramDice } from "./samePaper.js";
export type { SamePaperOptions, WorkReference } from "./samePaper.js";
export { findInLibrary } from "./libraryMatch.js";
export { resolvePagePaper } from "./pagePaper.js";
export type { PagePaper } from "./pagePaper.js";
export { extractPaperIdentifiers } from "./paperIdentifiers.js";
export { deriveResolvedMetadata } from "./paperMetadata.js";
export { matchPdfToPaper } from "./matchPdfToPaper.js";
export type { MatchablePaper, PdfToMatch } from "./matchPdfToPaper.js";
