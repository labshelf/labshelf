/** Exports paper resolution's public API: merging page facts with registry records, settling a page's paper, library matching, same-work checks, matching a PDF to a paper, and the network imports. */
export { PAGE_TRUST, resolveMetadata, withAbstract, resolvePagePaper, extractPaperIdentifiers, deriveResolvedMetadata } from "./resolveMetadata.js";
export type { MetadataOrigin, PagePaper } from "./resolveMetadata.js";
export { isSameWork, deriveWordBigramDice, deriveSurname, findInLibrary, matchPdfToPaper } from "../samePaper.js";
export type { SamePaperOptions, WorkReference, MatchablePaper, PdfToMatch } from "../samePaper.js";
export type { NetworkImportEnv, IdentifierImportOptions, ImportedPaper } from "./networkImport.js";
export { importNetworkInput, writeImportedPaper } from "./networkImport.js";
