/** Declares what every library mutation runs over: the injected ports and the shapes of its results. */
import type { PaperRecord } from "../../model/index.js";
import type { PathOps } from "../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";

/** Writes metadata.yaml and bib.bib for a paper; the core BibTeXService satisfies it. */
export interface MetadataWriter {
  writePaperArtifacts(folder: string, paper: PaperRecord, sourceFileName: string): Promise<void>;
}

export interface MutationContext {
  fs: LibraryFileSystem;
  paths: PathOps;
  artifacts: MetadataWriter;
  logger: ILogger;
  /** The papers/ folder: folder operations refuse to rename, move or trash it. */
  papersRoot: string;
  /** ISO timestamp for text-layer verdicts; the wall clock when absent. */
  now?: () => string;
}

/** A paper as the app's index knows it: enough to find its folder. */
export interface Reference {
  id: string;
  path: string;
}

export interface BatchOutcome {
  done: string[];
  failed: Array<{ id: string; error: string }>;
}

export const MUTATIONS_MODULE = "library/mutations";
