/** Exports the paper import's public API: identifier detection, metadata sources, the PDF pipeline, landing pages, PDF finding, network imports, BibTeX and the citation map. */
export * from "./identifiers/index.js";
export {
  fetchCrossrefByDoi,
  searchCrossref,
  fetchArxivByIdentifier,
  fetchPubmedByPmid,
  resolvePmidFromPmcid,
  openAlexSearch,
  openAlexWork,
  fetchDataciteByDoi,
  openLibraryByIsbn,
  fetchSemanticScholarByTitle,
  fetchSemanticScholarByDoi,
  searchEuropePmc,
  searchDblp,
  fetchGoogleBooksByIsbn,
  DEFAULT_CONTACT_EMAIL,
  findPublishedDoi,
  mergeMetadata,
  deriveCompleteness,
  normalizeCitationFields,
  SOURCE_TRUST,
  extractYear,
  resolveOnlineMetadata,
  resolveFirstIdentifier,
  fetchMetadataSourcesByDoi,
  searchOnlineByText,
  searchOnlineByTitle,
  searchOnlineByQueries,
  searchOnlineCandidates,
  deriveTitleOverlap,
} from "./registries/index.js";
export type { OpenAlexCitationWork, PreprintIds, RegistryEnv, RegistryEntry, ResolvedMetadata, MetadataConfidence, MetadataSource, MergedMetadata } from "./registries/index.js";
export * from "./pdf/index.js";
export * from "./bibtex/index.js";
export type { PageFacts, PdfCandidate, RawAuthorEmail, RawMailto, RawPage } from "./htmlPage.js";
export { parseHtmlPage, findRedirectUrls } from "./htmlPage.js";
export { derivePageFacts, fetchLanding } from "./pageFacts.js";
export type { AuthorContact, AuthorContactsInput } from "./authorContacts.js";
export { deriveAuthorContacts, extractEmailFromAffiliation, findAuthorContacts } from "./authorContacts.js";
export * from "./paper/index.js";
export * from "./pdfFinder/index.js";
