/** Exports the runtime-neutral quotes API: the cite keys behind a place of a compiled PDF and the library papers they name. */
export { createBibliographyCardEntry, deriveCitationEntries } from "./deriveCitationEntries.js";
export type { CitationDetails } from "./deriveCitationEntries.js";
export { findCiteKeysAt, findCiteKeysOnLine } from "./citeKeysAt.js";
export type { CitationSources, SourceLine } from "./citeKeysAt.js";
export { listQuotedHighlights } from "./listQuotedHighlights.js";
export type { QuotedHighlight } from "./listQuotedHighlights.js";
export { deriveCiteKey, findTypstCitationAt } from "./pdfCiteLocations.js";
export type { TypstCitation } from "./pdfCiteLocations.js";
