/** Exports metadata resolution's public API: merging page facts with registry records, library matching and same-work checks. */
export { PAGE_TRUST, resolveMetadata, withAbstract } from "./resolveMetadata.js";
export type { MetadataOrigin } from "./resolveMetadata.js";
export { surname } from "./titleAgreement.js";
export { sameWork, wordBigramDice } from "./sameWork.js";
export type { SameWorkOptions, WorkRef } from "./sameWork.js";
export { findInLibrary } from "./libraryMatch.js";
export { idsFromRecord } from "./recordIds.js";
export { metadataFromRecord } from "./recordMetadata.js";
