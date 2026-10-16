/** Exports landing-page reading's public API: HTML to raw evidence, evidence to a paper's facts. */
export type { PageFacts, PdfCandidate, RawAuthorEmail, RawMailtoLink, RawPage } from "./types.js";
export { parseHtmlPage, redirectTargets } from "./htmlPage.js";
export { interpretPage } from "./pageFacts.js";
export { fetchLandingPage } from "./landingPage.js";
export type { AuthorContact } from "./contacts/index.js";
export { authorContacts, emailFromAffiliation, findAuthorContacts, type ContactLookup } from "./contacts/index.js";
