/** Lists and describes the files inside a paper folder: which entries the file tray shows, the shape of its listing, and
 * the user's descriptions stored under the `files` key of metadata.yaml. */
import type { PaperRecord } from "../model/index.js";
import type { LibraryFileSystem, ILogger } from "../ports/index.js";
import { formatError } from "../errors/index.js";
import { BIB_FILE, METADATA_FILE, PDF_FILE } from "./layout.js";
import { readPaperOnFileSystem, writePaperRecord, type MutationContext } from "./mutations/index.js";

/** One entry of a paper folder as the file tray lists it; metadata.yaml, bib.bib and dot files never appear. */
export interface PaperFile {
  /** The entry's name inside the paper folder: one path segment. */
  name: string;
  kind: "file" | "folder";
  /** Size in bytes; files only. */
  size?: number;
  /** ISO timestamp of the last change. */
  modified: string;
  /** The user's description from metadata.yaml `files`; absent when there is none. */
  description?: string;
}

/** A paper's file listing: paper.pdf first, then other files, then subfolders, each by name; or why it could not be read. */
export type PaperFilesState = { status: "ready"; files: PaperFile[] } | { status: "failed"; message: string };

/** metadata.yaml, bib.bib and every dot entry (`.keep` included) belong to the library, not to the user's files. */
export function isHiddenPaperEntry(name: string): boolean {
  return name === METADATA_FILE || name === BIB_FILE || name.startsWith(".");
}

/**
 * Sets (trimmed) or clears the description of one name and drops descriptions of names missing from `onDisk`.
 * @returns the new map; `{}` when no description is left, which removes the `files` key; undefined when `name` is not
 * on disk and there is a description to set
 */
export function describePaperFile(
  files: Record<string, string> | undefined,
  name: string,
  description: string,
  onDisk: readonly string[],
): Record<string, string> | undefined {
  const text = description.trim();
  if (text && !onDisk.includes(name)) { return undefined; }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(files ?? {})) {
    if (key !== name && onDisk.includes(key)) { next[key] = value; }
  }
  if (text) { next[name] = text; }
  return next;
}

/**
 * Sets (trimmed) or clears the description of `name`, dropping descriptions of names missing from the folder.
 * @returns the paper as written, or undefined when the folder holds no paper
 * @throws when `name` is not a visible entry of the paper folder
 */
export async function describePaperFileOnFileSystem(
  ctx: MutationContext,
  folder: string,
  name: string,
  description: string,
): Promise<PaperRecord | undefined> {
  const current = await readPaperOnFileSystem(ctx, folder);
  if (!current) { return undefined; }
  const onDisk = (await ctx.fs.listDir(folder)).filter((entry) => !isHiddenPaperEntry(entry));
  const files = isHiddenPaperEntry(name) ? undefined : describePaperFile(current.files, name, description, onDisk);
  if (!files) { throw new Error(`Cannot describe "${name}": it is not a file of the paper in ${folder}`); }
  // CONTRACT: documents/contracts/library-format.md#metadatayaml
  const written = await writePaperRecord(ctx, { ...current, files }, { ownsStatus: true });
  await ctx.logger.log("INFO", "paperFiles", "File description saved", { id: current.id, name, cleared: !description.trim() });
  return written;
}

const byName = (a: PaperFile, b: PaperFile): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Reads a paper folder: paper.pdf first, then other files by name, then subfolders by name.
 * @returns the listing, or a failed state (also logged with the folder path) when the folder cannot be read
 */
export async function listPaperFiles(
  fs: Pick<LibraryFileSystem, "listDir" | "stat">,
  paperDir: string,
  descriptions: Record<string, string> | undefined,
  logger: ILogger,
): Promise<PaperFilesState> {
  try {
    const names = (await fs.listDir(paperDir)).filter((name) => !isHiddenPaperEntry(name));
    const entries = await Promise.all(names.map((name) => describeEntry(fs, paperDir, name, descriptions)));
    const present = entries.filter((entry): entry is PaperFile => entry !== undefined);
    const pdf = present.filter((entry) => entry.name === PDF_FILE && entry.kind === "file");
    const files = present.filter((entry) => entry.kind === "file" && entry.name !== PDF_FILE).sort(byName);
    const folders = present.filter((entry) => entry.kind === "folder").sort(byName);
    return { status: "ready", files: [...pdf, ...files, ...folders] };
  } catch (error) {
    await logger.error("paperFiles", error, { paperDir, action: "list" });
    return { status: "failed", message: formatError(error) };
  }
}

// An entry that vanished between the listing and the stat is left out.
async function describeEntry(
  fs: Pick<LibraryFileSystem, "stat">,
  paperDir: string,
  name: string,
  descriptions: Record<string, string> | undefined,
): Promise<PaperFile | undefined> {
  const stat = await fs.stat(`${paperDir}/${name}`);
  if (!stat) { return undefined; }
  const entry: PaperFile = { name, kind: stat.isDirectory ? "folder" : "file", modified: new Date(stat.mtimeMs).toISOString() };
  if (!stat.isDirectory) { entry.size = stat.size; }
  const description = descriptions?.[name];
  if (description) { entry.description = description; }
  return entry;
}
