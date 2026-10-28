/** Exports the runtime-neutral citation API: citations in sources, where a key is being typed, the citation text and page argument, papers by cite key, the cite keys behind a compiled PDF and the library papers they name, labshelf.bib and the main file's bibliography line, the papers list of labshelf.yaml and the reading list, backlinks, and the bibliography linter. */
export { findCiteKeyOccurrences, scanCiteKeys, findCitationSites } from "./citeKeys.js";
export type { CiteKeyOccurrence, CitationSite } from "./citeKeys.js";
export { findPartialCiteKeyStart, derivePageArgument } from "./citeKeys.js";
export type { PageArgumentContext } from "./citeKeys.js";
export { createCitationSnippet, derivePageSupplement, deriveQuotationBefore } from "./citeKeys.js";
export { CITE_WITHOUT_PAGE, deriveChoiceCitationSpec, formatHighlightLabel, formatHighlightPage, derivePaperPickText } from "./citeKeys.js";
export type { HighlightChoice, PickText } from "./citeKeys.js";
export { deriveSuggestedCiteKey, derivePapersByCiteKey, findSourceHeadings } from "./citeKeys.js";
export type { SuggestableCiteKey, SourceHeading } from "./citeKeys.js";

export { parseBibEntries, extractPlainField, readBibField, BIBLIOGRAPHY_HEADER, createBibliography, withBibliographyLine, listProjectCiteKeys, updateProjectBibliography } from "./bibliography.js";
export type { BibEntry, GeneratedBibliography, BibliographyLineResult } from "./bibliography.js";

export { checkBibliography, deriveMissingDoiFix, createPublishedVersionFinder } from "./bibliographyChecks.js";
export type { BibliographyProblem, BibliographyFix, BibliographyCheckRule, PublishedVersion, PublishedVersionFinder } from "./bibliographyChecks.js";

export { syncListedPapers, buildReadingList } from "./papersSync.js";
export type { BibliographyUpdate, CitingProject, ReadingList, ReadingListEntry, ReadingListInput } from "./papersSync.js";

export { addBacklinks, deriveProjectBacklinks } from "./backlinks.js";
export type { Backlink, BacklinkMap } from "./backlinks.js";
export { DISK_ONLY, walkProjectSources } from "./projectSources.js";
export type { ProjectSource } from "./projectSources.js";

export { listQuotableHighlights, listQuotedHighlights, createBibliographyCardEntry, deriveCitationEntries, deriveCiteKey, findTypstCitationAt, findCiteKeysAt, findCiteKeysOnLine } from "./quotes.js";
export type { QuotedHighlight, CitationDetails, TypstCitation, CitationSources, SourceLine } from "./quotes.js";
