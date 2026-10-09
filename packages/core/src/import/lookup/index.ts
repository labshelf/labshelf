/** Barrel for online registry lookups: confirming identifiers, searching by text, enriching and listing candidates. */
export { resolveOnlineMetadata, resolveFirstIdentifier } from "./confirmIdentifier.js";
export { searchOnlineByText, searchOnlineByTitle, searchOnlineByQueries } from "./searchByText.js";
export { searchOnlineCandidates } from "./candidates.js";
export { enrichByDoi } from "./enrichByDoi.js";
export { titleOverlap } from "./titleMatch.js";
