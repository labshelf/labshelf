/** Exports author-contact reading's public API: page evidence to author addresses, and PubMed affiliations to an address. */
export type { AuthorContact } from "./authorContacts.js";
export { deriveAuthorContacts } from "./authorContacts.js";
export { extractEmailFromAffiliation } from "./affiliation.js";
export { findAuthorEmailMetas, findMailtos } from "./authorEvidence.js";
export { findAuthorContacts, type ContactFinder } from "./findAuthorContacts.js";
