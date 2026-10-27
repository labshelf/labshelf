/** Exports the bibliographic registry clients, the record shape they return, the metadata merge rules and field helpers, and the lookups that confirm identifiers and search by text. */
export { fetchCrossrefByDoi, searchCrossref, fetchDataciteByDoi, fetchSemanticScholarByTitle, fetchSemanticScholarByDoi, findPublishedDoi, type PreprintIds } from "./doiRegistries.js";
export { fetchArxivByIdentifier, parseArxivFeed, fetchPubmedByPmid, resolvePmidFromPmcid, fetchPubmedAuthorsByDoi, searchEuropePmc, searchDblp } from "./bibliographic.js";
export { openAlexSearch, openAlexAutocomplete, openAlexWork, type OpenAlexCitationWork } from "./openalex.js";
export { openLibraryByIsbn, fetchGoogleBooksByIsbn } from "./books.js";
export { DEFAULT_CONTACT_EMAIL, type RegistryEntry, type RegistryEnv } from "./http.js";
export type { ResolvedMetadata, MetadataConfidence, MetadataSource, MergedMetadata } from "./metadata.js";
export { mergeMetadata, deriveCompleteness, normalizeCitationFields, SOURCE_TRUST, extractYear, normalizeWhitespace } from "./metadata.js";
export { resolveOnlineMetadata, resolveFirstIdentifier, fetchMetadataSourcesByDoi } from "./checkIdentifier.js";
export { searchOnlineByText, searchOnlineByTitle, searchOnlineByQueries, searchOnlineCandidates, deriveTitleOverlap } from "./searchByText.js";
