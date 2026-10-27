// Lists the entries of a paper folder that the file tray shows, joined with the user's descriptions.
import type { LibraryFileSystem, ILogger } from "../../ports/index.js";
import { PDF_FILE } from "../layout.js";
import { isHiddenPaperEntry } from "./hiddenEntries.js";
import type { PaperFile, PaperFilesState } from "./paperFile.js";
import { formatError } from "../../errors/index.js";

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
