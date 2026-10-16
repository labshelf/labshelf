/** Exports the runtime-neutral citation API: citations in sources, where a key is being typed, labshelf.bib text and the main file's bibliography line, the page argument of a citation, papers by cite key. */
export { BIBLIOGRAPHY_HEADER, generateBibliography } from "./bibliographyFile.js";
export type { GeneratedBibliography } from "./bibliographyFile.js";
export { withBibliographyLine } from "./bibliographyLine.js";
export type { BibliographyLineResult } from "./bibliographyLine.js";
export { partialKeyStart } from "./citationCompletion.js";
export { pageSupplement, quotationBefore } from "./citedText.js";
export { pageArgumentContext } from "./pageArgument.js";
export type { PageArgumentContext } from "./pageArgument.js";
export { papersByCiteKey } from "./papersByCiteKey.js";
export { citedKeys, scanCitationKeys } from "./citationKeys.js";
export type { CitedKey } from "./citationKeys.js";
