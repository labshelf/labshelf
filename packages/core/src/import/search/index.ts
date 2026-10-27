/** Exports the online registry lookups' public API: confirming identifiers, searching by text, enriching and listing candidates. */
export { resolveOnlineMetadata, resolveFirstIdentifier, fetchMetadataSourcesByDoi } from "./checkIdentifier.js";
export { searchOnlineByText, searchOnlineByTitle, searchOnlineByQueries, searchOnlineCandidates, deriveTitleOverlap } from "./searchByText.js";
