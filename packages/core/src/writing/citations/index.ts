/** Exports the runtime-neutral citation API: citations in sources, where a key is being typed, labshelf.bib text and the main file's bibliography line. */
export { BIBLIOGRAPHY_HEADER, generateBibliography } from "./bibliographyFile.js";
export type { GeneratedBibliography } from "./bibliographyFile.js";
export { withBibliographyLine } from "./bibliographyLine.js";
export type { BibliographyLineResult } from "./bibliographyLine.js";
export { partialKeyStart } from "./citationCompletion.js";
export { citedKeys, scanCitationKeys } from "./citationKeys.js";
export type { CitedKey } from "./citationKeys.js";
