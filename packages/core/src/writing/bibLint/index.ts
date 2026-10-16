/** Exports the bibliography linter: .bib parsing, lint findings with fixes, and the published-version lookup. */
export { bibEntries, plainField, type BibEntry } from "./bibEntries.js";
export type { BibFinding, BibFix, BibLintRule } from "./bibLintTypes.js";
export { lintBibliography } from "./lintBibliography.js";
export { missingDoiFix } from "./missingDoiFix.js";
export { publishedVersionLookup, type PublishedVersion, type PublishedVersionLookup } from "./publishedVersionRule.js";
