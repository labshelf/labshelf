/** Exports the runtime-neutral quotes API: the cite keys behind a place of a compiled PDF and the library papers they name. */
export { bibCardEntry, citationEntries } from "./citationEntries.js";
export type { CitationDetails } from "./citationEntries.js";
export { citedKeysAt, keysOnLine } from "./citeKeysAt.js";
export type { CitationSources, SourceLine } from "./citeKeysAt.js";
export { quotedHighlights } from "./quotedHighlights.js";
export type { QuotedHighlight } from "./quotedHighlights.js";
export { citationDestKey, typstCiteAt } from "./pdfCiteLocations.js";
export type { TypstCite } from "./pdfCiteLocations.js";
