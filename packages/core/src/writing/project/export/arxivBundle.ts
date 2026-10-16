/** Chooses the files of an arXiv bundle and rewrites each user .bib to the entries the project cites. */

import { bibEntries } from "../../bibLint/index.js";
import { DEFAULT_BIBLIOGRAPHY } from "../projectFile.js";
import { projectFiles } from "./projectFiles.js";

export interface BibText {
  path: string;
  text: string;
}

export interface ArxivBundle {
  /** Files copied as they are; the .bbl stays when the project has one. */
  files: string[];
  /** The user's .bib files with only cited entries; @string, @preamble and comments stay. */
  bibs: BibText[];
}

// `end` is exclusive, so the slice [start, end) ends with the entry's closing delimiter.
function citedOnly(text: string, cited: ReadonlySet<string>): string {
  return bibEntries(text).filter((entry) => !cited.has(entry.key)).reduceRight(
    (kept, entry) => kept.slice(0, entry.start) + kept.slice(entry.end), text);
}

export function arxivBundle(sources: string[], bibs: BibText[], citedKeys: string[]): ArxivBundle {
  const user = bibs.filter((bib) => bib.path !== DEFAULT_BIBLIOGRAPHY);
  const rewritten = new Set(user.map((bib) => bib.path));
  const cited = new Set(citedKeys);
  return {
    files: projectFiles(sources).filter((path) => !rewritten.has(path)),
    bibs: user.map(({ path, text }) => ({ path, text: citedOnly(text, cited) })),
  };
}
