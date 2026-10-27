/** Keeps the papers list of a project's labshelf.yaml in line with the keys its sources cite, and builds the reading list from it. */

import type { PaperRecord } from "../../model/index.js";
import {
  readOptionalText, PROJECT_FILE, parseProjectFile, updateProjectSettings, type ProjectReadContext, type ListedPaper, type ProjectSettings,
} from "../project/index.js";
import type { BacklinkMap } from "./backlinks.js";
import { derivePapersByCiteKey } from "./citeKeys.js";

// --- Papers list ---
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

export interface CitingProject {
  folder: string;
  settings: ProjectSettings;
  /** Main file relative to the folder; undefined when the project has none yet. */
  main: string | undefined;
}

export interface BibliographyUpdate {
  /** True when labshelf.bib was written; an unchanged file is not rewritten. */
  written: boolean;
  /** True when the papers list of labshelf.yaml was rewritten. */
  papersWritten: boolean;
  missing: string[];
  /** "conflict": the Typst main file already loads another bibliography, so labshelf.bib must be added by hand. */
  mainLine: "present" | "added" | "conflict" | "no-main" | "not-needed";
}

/**
 * The list after syncing, or undefined when it is already in sync. Entries the user added are never removed, a DOI
 * already listed is never changed (a coauthor may not have the paper), and new entries are appended in key order.
 */
export function syncListedPapers(
  listed: readonly ListedPaper[], citedKeys: readonly string[], library: ReadonlyMap<string, PaperRecord>,
): ListedPaper[] | undefined {
  const cited = new Set(citedKeys);
  let changed = false;
  const next: ListedPaper[] = [];
  for (const entry of listed) {
    if (entry.cited && !cited.has(entry.key)) { changed = true; continue; }
    const doi = entry.doi || library.get(entry.key)?.doi || undefined;
    if (doi !== entry.doi) { changed = true; }
    next.push(doi ? { ...entry, doi } : entry);
  }
  const present = new Set(listed.map((entry) => entry.key));
  // Only library papers join the list: other cited keys are Typst labels or entries of the user's own .bib file.
  for (const key of [...cited].filter((candidate) => !present.has(candidate) && library.has(candidate)).sort()) {
    const doi = library.get(key)?.doi || undefined;
    next.push({ key, ...doi ? { doi } : {}, cited: true });
    changed = true;
  }
  return changed ? next : undefined;
}

// --- Syncing labshelf.yaml ---
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

/**
 * Writes `papers` when it differs from the sync of `findCiteKeyOccurrences`; true when it wrote. The list is read from disk, so a
 * stale caller cannot drop an entry added since it loaded the project. A labshelf.yaml that does not parse fails the call.
 */
export async function syncProjectPapers(
  context: ProjectReadContext, folder: string, citedKeys: readonly string[], library: readonly PaperRecord[],
): Promise<boolean> {
  const file = context.paths.join(folder, PROJECT_FILE);
  const text = await readOptionalText(context.fs, file);
  if (text === undefined) { return false; }
  const parsed = parseProjectFile(text);
  if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
  const next = syncListedPapers(parsed.settings.papers ?? [], citedKeys, derivePapersByCiteKey(library));
  if (next === undefined) { return false; }
  await updateProjectSettings(context, folder, { papers: next.length > 0 ? next : undefined });
  return true;
}

// --- Reading list ---

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
  backlinks: BacklinkMap;
  listed: readonly ListedPaper[];
  papersByKey: ReadonlyMap<string, PaperRecord>;
  /** Asked once per paper in the list. */
  isOpened: (paperId: string) => Promise<boolean>;
}

function citedKeysOf(backlinks: BacklinkMap, project: string): string[] {
  const keys: string[] = [];
  for (const [key, links] of backlinks) { if (links.some((link) => link.project === project)) { keys.push(key); } }
  return keys;
}

/** A project's reading list: the papers it cites plus those the user added, with whether each was ever opened. */
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
