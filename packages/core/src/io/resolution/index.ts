/** Public API of metadata resolution: merge a page's facts with registry records, and match papers against the library. */
export { PAGE_TRUST, resolveMetadata, withAbstract } from "./resolveMetadata.js";
export type { MetadataOrigin } from "./resolveMetadata.js";
export { surname } from "./titleAgreement.js";
export { findInLibrary } from "./libraryMatch.js";
export { idsFromRecord } from "./recordIds.js";
