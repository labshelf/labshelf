// Inserts a citation of a picked library paper at every cursor, then adds the paper to the project's labshelf.bib.
import { choiceCitationOptions, citationSnippet, type ILogger, type LibraryFileSystem, type PaperRecord, type ProjectEntry } from "@labshelf/core";
import { toast } from "@labshelf/core/dom";
import type { SourceEdits } from "../sourceUpdates";
import { createBrowserProjectData } from "../../project";
import { pickHighlight, pickPaper } from "./pickCitation";

const MODULE = "tabs.source";

export interface CitationInsertion {
  edits: SourceEdits;
  /** Saves the file, so the bibliography update sees the new key; resolves whether the file is saved. */
  flush(): Promise<boolean>;
  entry: Extract<ProjectEntry, { kind: "ready" }>;
  fs: LibraryFileSystem;
  logger: ILogger;
  papers(): Promise<PaperRecord[]>;
}

// The paper's BibTeX entry reaches labshelf.bib here; the share merges it when the project is shared.
async function updateBibliography({ flush, entry, fs, logger, papers }: CitationInsertion): Promise<void> {
  try {
    if (!await flush()) throw new Error("The file could not be saved");
    const update = await createBrowserProjectData({ fs, logger }).updateProjectBibliography(entry, await papers());
    void logger.log("INFO", MODULE, "bibliography updated after a citation", { projectId: entry.settings.id, ...update });
  } catch (error) {
    void logger.error(MODULE, error, { action: "updateBibliography", projectId: entry.settings.id });
    toast("Could not update labshelf.bib.", "error");
  }
}

export async function citeFromLibrary(insertion: CitationInsertion): Promise<void> {
  const { edits, entry, fs, logger, papers } = insertion;
  const paper = await pickPaper(papers);
  if (!paper) return;
  const choice = await pickHighlight(fs, logger, paper);
  if (!choice) return;
  edits.insertText(citationSnippet(entry.settings.format, paper.citeKey, choiceCitationOptions(choice)));
  await updateBibliography(insertion);
}
