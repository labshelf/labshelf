/** Public API of metadata resolution: merge a page's facts with registry records, match papers against the library and decide whether two records are the same work. */
export { PAGE_TRUST, resolveMetadata, withAbstract } from "./resolveMetadata.js";
export type { MetadataOrigin } from "./resolveMetadata.js";
export { surname } from "./titleAgreement.js";
export { sameWork, wordBigramDice } from "./sameWork.js";
export type { SameWorkOptions, WorkRef } from "./sameWork.js";
export { findInLibrary } from "./libraryMatch.js";
export { idsFromRecord } from "./recordIds.js";
export { metadataFromRecord } from "./recordMetadata.js";
