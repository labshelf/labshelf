/** Exports author-contact reading's public API: page evidence to author addresses, and PubMed affiliations to an address. */
export type { AuthorContact } from "./authorContacts.js";
export { authorContacts } from "./authorContacts.js";
export { emailFromAffiliation } from "./affiliation.js";
export { authorEmailMetasOf, mailtoLinksOf } from "./authorEvidence.js";
export { findAuthorContacts, type ContactLookup } from "./findAuthorContacts.js";
