/** Pairs cite keys with the library papers they name, in the shape the reader's citation card shows. */
import type { PaperRecord } from "../../model/index.js";
import type { CitationEntry, CitationCardPaper } from "../../reader/index.js";
import { papersByCiteKey } from "../citations/index.js";
import type { QuotedHighlight } from "./quotedHighlights.js";

/** What the card shows beyond the library record: highlights by paper id, citing section titles by cite key. */
export interface CitationDetails {
  highlights?: ReadonlyMap<string, QuotedHighlight[]>;
  citedIn?: ReadonlyMap<string, string[]>;
}

function citedPaper(key: string, paper: PaperRecord, details: CitationDetails): CitationCardPaper {
  const highlights = details.highlights?.get(paper.id);
  const citedIn = details.citedIn?.get(key);
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? [],
    status: paper.status,
    ...(paper.year !== undefined ? { year: paper.year } : {}),
    ...(paper.summary ? { summary: paper.summary } : {}),
    ...(highlights ? { highlights } : {}),
    ...(citedIn ? { citedIn } : {}),
  };
}

/** One entry per key, in the keys' order; a key no library paper has keeps an entry without a paper. */
export function citationEntries(keys: readonly string[], papers: readonly PaperRecord[], details: CitationDetails = {}): CitationEntry[] {
  const library = papersByCiteKey(papers);
  return [...new Set(keys)].map((key) => {
    const paper = library.get(key);
    return paper ? { key, paper: citedPaper(key, paper, details) } : { key };
  });
}
