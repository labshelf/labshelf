/** Cites the paper the reader shows in a writing project: what each project offers, the text a citation writes, and the papers entry that puts the paper in labshelf.bib. */

import type { PaperRecord } from "../../model/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ListedPaper, type ProjectFormat, type ProjectSettings } from "../project/index.js";
import { createCitationSnippet } from "./citeKeys.js";
import { listFolderCiteKeys } from "./papersSync.js";

/** What the reader sends: the page and the selected or highlighted text, both absent for the whole paper. */
export interface ReaderCitation {
  page?: number | undefined;
  quote?: string | undefined;
}

export type ReaderCiteAction = "cite" | "citeQuoted" | "bibliography";

export interface ReaderCiteChoice {
  action: ReaderCiteAction;
  label: string;
  description: string;
}

type BibliographySettings = Pick<ProjectSettings, "papers" | "libraryFolders" | "bibliography">;

const QUOTE_LENGTH = 60;

/** Whether the project's labshelf.bib holds the paper: listed in `papers` (cited or added by the user) or inside a linked library folder. */
export function isInProjectBibliography(settings: BibliographySettings, paper: PaperRecord): boolean {
  return (settings.papers ?? []).some((entry) => entry.key === paper.citeKey)
    || listFolderCiteKeys([paper], settings.libraryFolders).length > 0;
}

/** The citation an action writes, with the page and, for `citeQuoted`, the quotation before it. */
export function createReaderCitation(format: ProjectFormat, key: string, citation: ReaderCitation, quoted: boolean): string {
  return createCitationSnippet(format, key, {
    ...(citation.page === undefined ? {} : { page: citation.page }),
    ...(quoted && citation.quote ? { quotation: citation.quote } : {}),
  });
}

/**
 * The actions a project offers: cite into its open source file (or copy the citation when none is open), cite with
 * the quotation when there is one, and add the paper to labshelf.bib when it is not there yet.
 * @param openSource the name of the project's open source file the citation goes into; undefined when none is open
 */
export function deriveReaderCiteChoices(
  project: { format: ProjectFormat; settings: BibliographySettings }, paper: PaperRecord, citation: ReaderCitation, openSource: string | undefined,
): ReaderCiteChoice[] {
  const where = openSource === undefined ? "Copy" : `Cite in ${openSource}`;
  const choices: ReaderCiteChoice[] = [{
    action: "cite",
    label: openSource === undefined ? "Copy the citation" : where,
    description: createReaderCitation(project.format, paper.citeKey, citation, false),
  }];
  const quote = citation.quote?.replace(/\s+/g, " ").trim();
  if (quote) {
    choices.push({
      action: "citeQuoted",
      label: `${where} with the quotation`,
      description: quote.length > QUOTE_LENGTH ? `“${quote.slice(0, QUOTE_LENGTH).trimEnd()}…”` : `“${quote}”`,
    });
  }
  if (!isInProjectBibliography(project.settings, paper)) {
    choices.push({ action: "bibliography", label: `Add to ${project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY}`, description: "without citing it yet" });
  }
  return choices;
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
