/** Exports landing-page reading's public API: HTML to raw evidence, evidence to a paper's facts. */
export type { PageFacts, PdfCandidate, RawAuthorEmail, RawMailto, RawPage } from "./rawPage.js";
export { parseHtmlPage, findRedirectUrls } from "./htmlPage.js";
export { derivePageFacts } from "./pageFacts.js";
export { fetchLanding } from "./fetchLanding.js";
export type { AuthorContact } from "./author/index.js";
export { deriveAuthorContacts, extractEmailFromAffiliation, findAuthorContacts, type AuthorContactsInput } from "./author/index.js";
