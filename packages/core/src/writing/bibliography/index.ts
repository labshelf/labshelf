/** Exports the bibliography linter: .bib parsing, lint findings with fixes, and the published-version lookup. */
export { parseBibEntries, extractPlainField, type BibEntry } from "./parseBibEntries.js";
export type { BibliographyProblem, BibliographyFix, BibliographyCheckRule } from "./bibliographyReport.js";
export { checkBibliography } from "./checkBibliography.js";
export { deriveMissingDoiFix } from "./deriveMissingDoiFix.js";
export { createPublishedVersionFinder, type PublishedVersion, type PublishedVersionFinder } from "./publishedVersionRule.js";
