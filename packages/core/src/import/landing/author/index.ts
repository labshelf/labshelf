/** Exports author-contact reading's public API: page evidence to author addresses, and PubMed affiliations to an address. */
export type { AuthorContact } from "./deriveAuthorContacts.js";
export { deriveAuthorContacts } from "./deriveAuthorContacts.js";
export { extractEmailFromAffiliation } from "./affiliation.js";
export { findAuthorEmailMetas, findMailtos } from "./authorEvidence.js";
export { findAuthorContacts, type AuthorContactsInput } from "./findAuthorContacts.js";
