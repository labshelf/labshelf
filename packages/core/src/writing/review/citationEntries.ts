/** Pairs cite keys with the library papers they name, in the shape the reader's citation card shows. */
import type { PaperRecord } from "../../model/index.js";
import { PAPERS_DIR } from "../../library/index.js";
import type { CitationBibEntry, CitationEntry, CitationCardPaper, CitingCommand } from "../../reader/index.js";
import { plainField, type BibEntry } from "../bibLint/index.js";
import { papersByCiteKey } from "../citations/index.js";
import type { QuotedHighlight } from "./quotedHighlights.js";

/** What the card shows beyond the library record: highlights by paper id; the rest by cite key. */
export interface CitationDetails {
  highlights?: ReadonlyMap<string, QuotedHighlight[]>;
  /** The `.bib` record of a key, shown only when no library paper has the key. */
  bib?: ReadonlyMap<string, CitationBibEntry>;
  /** The citing command at the queried place. */
  site?: ReadonlyMap<string, CitingCommand>;
  /** The page the citing command names. */
  citedPage?: ReadonlyMap<string, number>;
}

// A paper's path is `papers/<folder>/.../<id>`; a paper at the library root has no folder.
function folderOf(path: string): string | undefined {
  const parts = path.split("/");
  const folders = parts[0] === PAPERS_DIR ? parts.slice(1, -1) : [];
  return folders.length > 0 ? folders.join(" / ") : undefined;
}

function citedPaper(paper: PaperRecord, details: CitationDetails): CitationCardPaper {
  const highlights = details.highlights?.get(paper.id);
  const folder = folderOf(paper.path);
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? [],
    status: paper.status,
    ...(paper.year !== undefined ? { year: paper.year } : {}),
    ...(paper.journal ? { venue: paper.journal } : {}),
    ...(folder ? { folder } : {}),
    ...(highlights ? { highlights } : {}),
  };
}

/** One entry per key, in the keys' order; a key no library paper has keeps an entry with its `.bib` record, if any. */
export function citationEntries(keys: readonly string[], papers: readonly PaperRecord[], details: CitationDetails = {}): CitationEntry[] {
  const library = papersByCiteKey(papers);
  return [...new Set(keys)].map((key) => {
    const paper = library.get(key);
    const bib = paper ? undefined : details.bib?.get(key);
    const site = details.site?.get(key);
    const citedPage = details.citedPage?.get(key);
    return {
      key,
      ...(paper ? { paper: citedPaper(paper, details) } : {}),
      ...(bib ? { bib } : {}),
      ...(site ? { site } : {}),
      ...(citedPage !== undefined ? { citedPage } : {}),
    };
  });
}

const VENUE_FIELDS = ["journal", "journaltitle", "booktitle", "publisher"] as const;

/** A `.bib` record in the shape the citation card shows; fields the record lacks are left out. */
export function bibCardEntry(entry: BibEntry): CitationBibEntry {
  const title = plainField(entry.fields.get("title"));
  const authors = plainField(entry.fields.get("author")).split(/\s+and\s+/).filter((name) => name !== "");
  const year = Number(/\d{4}/.exec(plainField(entry.fields.get("year") ?? entry.fields.get("date")))?.[0]);
  const venue = VENUE_FIELDS.map((field) => plainField(entry.fields.get(field))).find((value) => value !== "");
  return { authors, ...(title ? { title } : {}), ...(year ? { year } : {}), ...(venue ? { venue } : {}) };
}
