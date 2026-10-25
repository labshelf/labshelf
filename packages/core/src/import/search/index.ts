/** Exports the online registry lookups' public API: confirming identifiers, searching by text, enriching and listing candidates. */
export { resolveOnlineMetadata, resolveFirstIdentifier } from "./checkIdentifier.js";
export { searchOnlineByText, searchOnlineByTitle, searchOnlineByQueries } from "./searchByText.js";
export { searchOnlineCandidates } from "./candidates.js";
export { fetchMetadataSourcesByDoi } from "./fetchMetadataSourcesByDoi.js";
export { deriveTitleOverlap } from "./titleMatch.js";
