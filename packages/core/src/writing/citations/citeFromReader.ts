/** Cites the paper the reader shows in a writing project: whether a project lists it, the text a citation writes, and the papers entry that puts the paper in labshelf.bib. */

import type { PaperRecord } from "../../model/index.js";
import type { ListedPaper, ProjectFormat, ProjectSettings } from "../project/index.js";
import { createCitationSnippet } from "./citeKeys.js";
import { listFolderCiteKeys } from "./papersSync.js";

/** What the reader sends: the page and the selected or highlighted text, both absent for the whole paper. */
export interface ReaderCitation {
  page?: number | undefined;
  quote?: string | undefined;
}

type BibliographySettings = Pick<ProjectSettings, "papers" | "libraryFolders" | "bibliography">;

/** Whether the project's labshelf.bib holds the paper: listed in `papers` (cited or added by the user) or inside a linked library folder. */
export function isInProjectBibliography(settings: BibliographySettings, paper: PaperRecord): boolean {
  return (settings.papers ?? []).some((entry) => entry.key === paper.citeKey)
    || listFolderCiteKeys([paper], settings.libraryFolders).length > 0;
}

/** The citation the reader writes, with the page and, when `quoted`, the quotation before it. */
export function createReaderCitation(format: ProjectFormat, key: string, citation: ReaderCitation, quoted: boolean): string {
  return createCitationSnippet(format, key, {
    ...(citation.page === undefined ? {} : { page: citation.page }),
    ...(quoted && citation.quote ? { quotation: citation.quote } : {}),
  });
}

/**
 * The papers list with the paper added by the user, so labshelf.bib keeps it whether the sources cite it or not. An
 * entry the sync listed as cited becomes the user's; undefined when the user already listed the paper.
 */
export function withListedPaper(listed: readonly ListedPaper[], paper: Pick<PaperRecord, "citeKey" | "doi">): ListedPaper[] | undefined {
  const own = (doi: string | undefined): ListedPaper => (doi ? { key: paper.citeKey, doi } : { key: paper.citeKey });
  const present = listed.find((entry) => entry.key === paper.citeKey);
  if (present && !present.cited) { return undefined; }
  return present
    ? listed.map((entry) => (entry === present ? own(entry.doi ?? paper.doi) : entry))
    : [...listed, own(paper.doi)];
}

/** The keys of the user's `papers` entries that name a library paper; these go into labshelf.bib with the cited ones. Synced entries are left out, since a key the sources stopped citing must leave the file. */
export function listListedCiteKeys(listed: readonly ListedPaper[] | undefined, library: ReadonlyMap<string, PaperRecord>): string[] {
  return (listed ?? []).filter((entry) => !entry.cited && library.has(entry.key)).map((entry) => entry.key);
}
