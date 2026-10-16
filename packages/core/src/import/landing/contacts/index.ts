/** Exports author-contact reading's public API: page evidence to author addresses, and PubMed affiliations to an address. */
export type { AuthorContact } from "./authorContacts.js";
export { authorContacts } from "./authorContacts.js";
export { emailFromAffiliation } from "./emailFromAffiliation.js";
export { authorEmailMetasOf, mailtoLinksOf } from "./contactEvidence.js";
export { findAuthorContacts, type ContactLookup } from "./findAuthorContacts.js";
