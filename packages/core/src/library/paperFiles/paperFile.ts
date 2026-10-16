// Declares the shape of a paper folder's file listing shared by the listing function and the library UI protocol.

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
