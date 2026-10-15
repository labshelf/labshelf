// Builds the LibraryRef shape message handlers return, and checks whether a paper's PDF
// exists on disk — shared by the capture and library message handlers.
import { IndexedDbFileSystem } from "../../storage";
import type { LibraryRef } from "../../platform";
import { PDF_FILE, parentDir } from "@labshelf/core";

export function ref(id: string, path: string, hasPdf: boolean): LibraryRef {
  return { id, path, folder: parentDir(path, "/"), hasPdf };
}

/** Whether `<path>/paper.pdf` exists (one stat; library.lookup uses a bulk scan). */
export async function pdfExists(path: string): Promise<boolean> {
  return (await new IndexedDbFileSystem().stat(`${path}/${PDF_FILE}`)) !== undefined;
}
