/** Exports the metadata record's public API: the shared record, its merge rules and field helpers. */
export type { ResolvedMetadata, MetadataConfidence } from "./resolvedMetadata.js";
export { mergeMetadata, deriveCompleteness, SOURCE_TRUST } from "./merge.js";
export type { MetadataSource, MergedMetadata } from "./merge.js";
export { normalizeCitationFields } from "./normalizeCitationFields.js";
export { extractYear } from "./year.js";
export { parseString, normalizeWhitespace } from "./fieldText.js";
