/** Exports landing-page reading's public API: HTML to raw evidence, evidence to a paper's facts. */
export type { PageFacts, PdfCandidate, RawAuthorEmail, RawMailto, RawPage } from "./htmlPage.js";
export { parseHtmlPage, findRedirectUrls } from "./htmlPage.js";
export { derivePageFacts, fetchLanding } from "./pageFacts.js";
export type { AuthorContact, AuthorContactsInput } from "./authorContacts.js";
export { deriveAuthorContacts, extractEmailFromAffiliation, findAuthorContacts } from "./authorContacts.js";
