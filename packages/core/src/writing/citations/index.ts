/** Exports the runtime-neutral citation API: citations in sources, where a key is being typed, the citation text and page argument, papers by cite key, the cite keys behind a compiled PDF and the library papers they name, labshelf.bib and the main file's bibliography line, the papers list of labshelf.yaml and the reading list, backlinks, the bibliography linter, the targets a citation of one paper can point at, the scope a citation cites (.labshelf/citations.json) and what its hover shows of it, and the answers of the reader's cite popup. */
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

export { syncListedPapers, buildReadingList, listFolderCiteKeys, listLibraryFolderCounts, countLinkedFolders } from "./papersSync.js";
export type { LibraryFolderCount, BibliographyUpdate, CitingProject, ReadingList, ReadingListEntry, ReadingListInput } from "./papersSync.js";

export {
  readBibIdentifier, deriveBibPaperInput, createPaperFromBibEntry, planBibImport, deriveImportFolderName, formatLibraryFolder, describeBibImport,
} from "./bibliographyImport.js";
export type { BibImportPlan } from "./bibliographyImport.js";

export { addBacklinks, deriveProjectBacklinks, citeSiteNotes } from "./backlinks.js";
export type { Backlink, BacklinkMap, CiteSiteNotes } from "./backlinks.js";
export { DISK_ONLY, walkProjectSources } from "./projectSources.js";
export type { ProjectSource } from "./projectSources.js";

export { listQuotableHighlights, listQuotedHighlights, createBibliographyCardEntry, deriveCitationEntries, deriveCiteKey, findTypstCitationAt, locateTypstCitationAt, findCiteKeysAt, findCiteKeysOnLine } from "./quotes.js";
export type { QuotedHighlight, CitationDetails, TypstCitation, CitationSources, SourceLine } from "./quotes.js";

export { listCiteTargets, formatCiteTarget, deriveNotePage, deriveCitedKeyContext, rewriteCitation, deriveNotePageSupplement, deriveNoteProseBefore, PAGE_SLOT, listCardNotes } from "./citeTargets.js";
export type { CiteTarget, CitedKeyContext } from "./citeTargets.js";
export { createReaderCitation, isInProjectBibliography, listListedCiteKeys, withListedPaper } from "./citeFromReader.js";
export type { ReaderCitation } from "./citeFromReader.js";
export { answerManuscriptInsert, answerReaderCite } from "./readerCite.js";
export type { CiteProject, CiteReply, CiteRequest, ManuscriptInsert, ReaderCiteIo } from "./readerCite.js";
export {
  CITATION_SCOPES_FILE, createScopedCitation, formatCitationScopes, parseCitationScopes, pruneCitationScopes, reanchorCitationScopes, recordCitationScope, resolveCitationScope,
} from "./citationScopes.js";
export type { CitationScope, CitationScopeLookups, CitationScopeRecord } from "./citationScopes.js";
export { deriveScopedCitationContent } from "./scopedContent.js";
export type { ScopedCitationContent, ScopedCitationMark } from "./scopedContent.js";
