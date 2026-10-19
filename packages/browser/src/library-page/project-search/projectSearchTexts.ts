// Reads the text of the searchable files of a project folder.
import { isSearchableFile, listProjectFiles, posixPathOps, type LibraryFileSystem, type ProjectText } from "@labshelf/core";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The project's searchable files with their saved text; files over 2 MB are skipped. */
export async function projectSearchTexts(fs: LibraryFileSystem, folder: string): Promise<ProjectText[]> {
  const relatives = (await listProjectFiles({ fs, paths: posixPathOps }, folder)).filter(isSearchableFile);
  const texts: ProjectText[] = [];
  for (const relative of relatives) {
    const path = posixPathOps.join(folder, relative);
    if (((await fs.stat(path))?.size ?? 0) > MAX_FILE_BYTES) continue;
    texts.push({ path, text: await fs.readText(path) });
  }
  return texts;
}
