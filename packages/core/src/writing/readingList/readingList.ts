/** Builds a project's reading list: the papers it cites plus those the user added, with whether each was ever opened. */
import type { PaperRecord } from "../../model/index.js";
import type { BacklinkIndex } from "../backlinks/index.js";
import type { ListedPaper } from "../project/index.js";

export interface ReadingListEntry {
  key: string;
  /** Undefined when no library paper has the key. */
  paper: PaperRecord | undefined;
  cited: boolean;
  listed: boolean;
  /** The paper has been opened in the reader; false for a key with no library paper. */
  opened: boolean;
}

export interface ReadingList {
  /** Cited keys in citation order, then listed keys the project does not cite. */
  entries: ReadingListEntry[];
  /** Cited library papers that were never opened. */
  neverOpened: number;
}

export interface ReadingListInput {
  project: string;
  backlinks: BacklinkIndex;
  listed: readonly ListedPaper[];
  papersByKey: ReadonlyMap<string, PaperRecord>;
  /** Asked once per paper in the list. */
  isOpened: (paperId: string) => Promise<boolean>;
}

function citedKeysOf(backlinks: BacklinkIndex, project: string): string[] {
  const keys: string[] = [];
  for (const [key, links] of backlinks) { if (links.some((link) => link.project === project)) { keys.push(key); } }
  return keys;
}

export async function buildReadingList(input: ReadingListInput): Promise<ReadingList> {
  const cited = new Set(citedKeysOf(input.backlinks, input.project));
  const listed = new Set(input.listed.map((entry) => entry.key));
  const keys = [...cited, ...[...listed].filter((key) => !cited.has(key))];
  const entries = await Promise.all(keys.map(async (key): Promise<ReadingListEntry> => {
    const paper = input.papersByKey.get(key);
    return { key, paper, cited: cited.has(key), listed: listed.has(key), opened: paper ? await input.isOpened(paper.id) : false };
  }));
  return { entries, neverOpened: entries.filter((entry) => entry.cited && entry.paper && !entry.opened).length };
}
