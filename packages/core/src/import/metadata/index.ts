/** Exports the metadata record's public API: the shared record, its merge rules and field helpers. */
export type { ResolvedMetadata, MetadataConfidence } from "./types.js";
export { mergeMetadata, completeness, SOURCE_TRUST } from "./merge.js";
export type { MetadataSource, MergedMetadata } from "./merge.js";
export { tidyCitationFields } from "./tidyCitationFields.js";
export { extractYear } from "./year.js";
export { asString, collapseWhitespace } from "./fieldValue.js";
