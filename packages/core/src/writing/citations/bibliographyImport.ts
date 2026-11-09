// Turns the entries of a .bib file into library papers: which entries the library already holds, the folder they go to, and the paper one entry becomes.

import { extractArxivIdentifierFromUrl, extractDoi, normalizeArxivIdentifier } from "../../import/index.js";
import { findInLibrary } from "../../import/paper/index.js";
import { createPaper, type CreatePaperInput, type MutationContext } from "../../library/mutations/index.js";
import type { PaperRecord } from "../../model/index.js";
import { readBibField, type BibEntry } from "./bibliography.js";
import { createBibliographyCardEntry } from "./quotes.js";

/** The DOI or arXiv id the entry names, in a form the importer takes (`arXiv:` prefix for a preprint). */
export function readBibIdentifier(entry: BibEntry): string | undefined {
  const doi = extractDoi(readBibField(entry, "doi"));
  if (doi) { return doi; }
  const arxiv = readBibArxivId(entry);
  return arxiv ? `arXiv:${arxiv}` : undefined;
}

function readBibArxivId(entry: BibEntry): string | undefined {
  return normalizeArxivIdentifier(readBibField(entry, "eprint")) ?? extractArxivIdentifierFromUrl(readBibField(entry, "url"));
}

/** The paper fields a .bib entry carries: title, authors, year, venue and the identifiers and locators it states. */
export function deriveBibPaperInput(entry: BibEntry, sourceName: string): CreatePaperInput {
  const card = createBibliographyCardEntry(entry);
  const optional = (name: string): string | undefined => readBibField(entry, name) || undefined;
  const doi = extractDoi(readBibField(entry, "doi"));
  const extras = { publisher: optional("publisher"), url: optional("url"), volume: optional("volume"), issue: optional("number"), pages: optional("pages"), doi };
  return {
    citeKey: entry.key,
    fields: {
      title: card.title ?? entry.key,
      ...(card.authors.length > 0 ? { authors: card.authors } : {}),
      ...(card.year ? { year: card.year } : {}),
      ...(card.venue ? { journal: card.venue } : {}),
      ...Object.fromEntries(Object.entries(extras).filter(([, value]) => value !== undefined)),
    },
    sourceName,
  };
}

/** Writes the paper a .bib entry describes, without a PDF, into `targetDir`; the entry's key is kept when free. */
export function createPaperFromBibEntry(
  ctx: MutationContext, takenIds: Iterable<string>, targetDir: string, entry: BibEntry, sourceName: string,
): Promise<PaperRecord> {
  return createPaper(ctx, takenIds, targetDir, deriveBibPaperInput(entry, sourceName));
}

export interface BibImportPlan {
  /** Entries no library paper matches, in file order. */
  fresh: BibEntry[];
  /** Entries a library paper already holds, with that paper's id. */
  existing: { key: string; id: string }[];
}

/**
 * Splits the entries by whether the library holds them: a paper with the same DOI, arXiv id or cite key (ignoring case) is the
 * same reference. An entry that repeats an earlier one of the file counts as held too.
 */
export function planBibImport(entries: readonly BibEntry[], papers: readonly PaperRecord[]): BibImportPlan {
  const byKey = new Map<string, string>();
  for (const paper of papers) { if (paper.citeKey && !byKey.has(paper.citeKey.toLowerCase())) { byKey.set(paper.citeKey.toLowerCase(), paper.id); } }
  const seen: PaperRecord[] = [];
  const plan: BibImportPlan = { fresh: [], existing: [] };
  for (const entry of entries) {
    const doi = extractDoi(readBibField(entry, "doi"));
    const query = { ...(doi ? { doi } : {}), ...(readBibArxivId(entry) ? { arxivId: readBibArxivId(entry) } : {}) };
    const match = findInLibrary([...papers], query) ?? findInLibrary(seen, query);
    const id = match?.id ?? byKey.get(entry.key.toLowerCase());
    if (id !== undefined) { plan.existing.push({ key: entry.key, id }); continue; }
    plan.fresh.push(entry);
    byKey.set(entry.key.toLowerCase(), entry.key);
    seen.push({ id: entry.key, citeKey: entry.key, title: "", path: "", status: "unread", ...(doi ? { doi } : {}), url: readBibField(entry, "url") });
  }
  return plan;
}

const FORBIDDEN_IN_FOLDER_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;
const FALLBACK_FOLDER = "Imported references";

/**
 * The library folder an imported file goes to: the file's base name, made safe for a folder, and numbered when taken.
 * @param isTaken whether a folder or paper of that name exists at the library root (compared by the caller, ignoring case)
 */
export async function deriveImportFolderName(fileName: string, isTaken: (name: string) => boolean | Promise<boolean>): Promise<string> {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.bib$/i, "").replace(FORBIDDEN_IN_FOLDER_NAME, "-").replace(/^\.+/, "").trim() || FALLBACK_FOLDER;
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!(await isTaken(name))) { return name; }
  }
}

/** A library folder path for display: its segments joined by " › ". */
export function formatLibraryFolder(folder: string): string {
  return folder.split("/").join(" › ");
}

/** The message that closes an import. */
export function describeBibImport(imported: number, folder: string, held: number): string {
  return `Imported ${imported} ${imported === 1 ? "reference" : "references"} into ${folder} (${held} already in your library).`;
}
