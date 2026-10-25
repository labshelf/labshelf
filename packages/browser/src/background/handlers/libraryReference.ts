// Builds the LibraryRef shape message handlers return, and checks whether a paper's PDF
// exists on disk — shared by the capture and library message handlers.
import { createLibraryFileSystem } from "../../storage";
import type { LibraryReference } from "../../platform";
import { PDF_FILE, deriveParentDir } from "@labshelf/core";

export function createLibraryReference(id: string, path: string, hasPdf: boolean): LibraryReference {
  return { id, path, folder: deriveParentDir(path, "/"), hasPdf };
}

/** Whether `<path>/paper.pdf` exists (one stat; library.lookup uses a bulk scan). */
export async function hasPdfFile(path: string): Promise<boolean> {
  return (await createLibraryFileSystem().stat(`${path}/${PDF_FILE}`)) !== undefined;
}
