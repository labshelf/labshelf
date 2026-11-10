// The source tab's side of Cite from Library: the project's .labshelf/citations.json read and written through the library folder,
// the bibliography update after a citation, and the scope hover's reads (plan editor-cite-popup D5).
import {
  CITATION_SCOPES_FILE, formatCitationScopes, formatError, listProjectFiles, parseCitationScopes, posixPathOps, pruneCitationScopes, reanchorCitationScopes,
  type CitationScopeRecord, type ILogger, type LibraryFileSystem, type PaperRecord, type ProjectEntry,
} from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import type { SourceEditorDeps } from "./session";
import { createBrowserProjectContent } from "./project";

const MODULE = "tabs.source";

export interface LibraryCitationContext {
  fs: LibraryFileSystem;
  logger: ILogger;
  entry: Extract<ProjectEntry, { kind: "ready" }>;
  /** Saves the open file, so the bibliography update sees the new key; resolves whether the file is saved. */
  flush(): Promise<boolean>;
  papers(): Promise<PaperRecord[]>;
}

/** What the editor's deps get for Cite from Library and the scope hover, and the re-anchoring the tab runs on each save. */
export interface LibraryCitationWiring {
  libraryCitation: NonNullable<SourceEditorDeps["libraryCitation"]>;
  scopesOf: NonNullable<SourceEditorDeps["scopesOf"]>;
  /** Re-finds the citations of `file` in `text`, which was just saved; writes only when something changed. */
  reanchor(file: string, text: string): Promise<void>;
}

// The paper's BibTeX entry reaches labshelf.bib here; the share merges it when the project is shared.
async function updateBibliography({ flush, entry, fs, logger, papers }: LibraryCitationContext): Promise<void> {
  try {
    if (!await flush()) throw new Error("The file could not be saved");
    const update = await createBrowserProjectContent({ fs, logger }).updateProjectBibliography(entry, await papers());
    void logger.log("INFO", MODULE, "bibliography updated after a citation", { projectId: entry.settings.id, ...update });
  } catch (error) {
    void logger.error(MODULE, error, { action: "updateBibliography", projectId: entry.settings.id });
    showToast("Could not update labshelf.bib.", "error");
  }
}

export function createLibraryCitationWiring(context: LibraryCitationContext): LibraryCitationWiring {
  const { fs, logger, entry } = context;
  const store = posixPathOps.join(entry.folder, CITATION_SCOPES_FILE);
  // The records as last read; dropped after every write here, so the next hover sees it.
  let cached: Promise<CitationScopeRecord[]> | undefined;
  // INVARIANT: a read-modify-write of the file starts after the one before it ended, so a save never loses a record being added.
  let writing: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<CitationScopeRecord[]> => ((await fs.exists(store)) ? parseCitationScopes(await fs.readText(store), logger) : []);
  const update = (change: (records: CitationScopeRecord[]) => Promise<CitationScopeRecord[]>): Promise<void> => {
    const run = writing.then(async () => {
      const before = await read();
      const after = await change(before);
      if (formatCitationScopes(after) === formatCitationScopes(before)) return;
      await fs.ensureDir(posixPathOps.dirname(store));
      await fs.writeText(store, formatCitationScopes(after));
    }).finally(() => { cached = undefined; });
    writing = run.catch(() => undefined);
    return run;
  };
  return {
    libraryCitation: {
      saveScope: (record) => update(async (records) => {
        const files = new Set(await listProjectFiles({ fs, paths: posixPathOps }, entry.folder));
        return [...pruneCitationScopes(records, files), record];
      }),
      refreshBibliography: () => updateBibliography(context),
    },
    scopesOf: (file) => (cached ??= read()).then((records) => records.filter((record) => record.file === file), (error: unknown) => {
      cached = undefined;
      void logger.error(MODULE, error, { action: "readCitationScopes", projectId: entry.settings.id, message: formatError(error) });
      return [];
    }),
    reanchor: (file, text) => update(async (records) => (records.some((record) => record.file === file) ? reanchorCitationScopes(records, file, text, entry.settings.format) : records)),
  };
}
