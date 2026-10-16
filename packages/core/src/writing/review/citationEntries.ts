/** Pairs cite keys with the library papers they name, in the shape the reader's citation card shows. */
import type { PaperRecord } from "../../model/index.js";
import type { CitationEntry, CitationCardPaper } from "../../reader/index.js";
import { papersByCiteKey } from "../citations/index.js";

function citedPaper(paper: PaperRecord): CitationCardPaper {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? [],
    ...(paper.year !== undefined ? { year: paper.year } : {}),
    ...(paper.summary ? { summary: paper.summary } : {}),
  };
}

/** One entry per key, in the keys' order; a key no library paper has keeps an entry without a paper. */
export function citationEntries(keys: readonly string[], papers: readonly PaperRecord[]): CitationEntry[] {
  const library = papersByCiteKey(papers);
  return [...new Set(keys)].map((key) => {
    const paper = library.get(key);
    return paper ? { key, paper: citedPaper(paper) } : { key };
  });
}
