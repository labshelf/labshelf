/** Exports review mode's runtime-neutral API: the cite keys behind a place of a compiled PDF and the library papers they name. */
export { bibCardEntry, citationEntries } from "./citationEntries.js";
export type { CitationDetails } from "./citationEntries.js";
export { citedKeysAt, keysOnLine } from "./citedKeysAt.js";
export type { CitationSources, SourceLine } from "./citedKeysAt.js";
export { quotedHighlights } from "./quotedHighlights.js";
export type { QuotedHighlight } from "./quotedHighlights.js";
export { citationDestKey, typstCiteAt } from "./pdfCitationTargets.js";
export type { TypstCite } from "./pdfCitationTargets.js";
