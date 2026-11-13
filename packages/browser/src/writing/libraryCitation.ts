// The source tab's side of Cite from Library: the project's .labshelf/citations.json read and written through the library folder,
// the bibliography update after a citation, and the scope hover's reads (plan editor-cite-popup D5).
import {
  CITATION_SCOPES_FILE, answerReaderCite, formatCitationScopes, formatError, listProjectFiles, parseCitationScopes, posixPathOps, pruneCitationScopes, reanchorCitationScopes, withListedPaper,
  type CitationScopeRecord, type CiteReply, type CiteRequest, type ILogger, type LibraryFileSystem, type PaperRecord, type ProjectEntry, type ReaderCiteIo,
} from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import { createProjectNoteFiles, listCachedPaperRecords } from "../storage";
import type { SourceEditorDeps } from "./session";
import { sendProjectFileChange } from "./fileChanges";
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

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

/** The library's ready projects, which the reader page's cite popup lists. */
async function listReady(fs: LibraryFileSystem, logger: ILogger): Promise<ReadyProject[]> {
  const entries = await createBrowserProjectContent({ fs, logger }).listProjects("");
  return entries.filter((entry): entry is ReadyProject => entry.kind === "ready");
}

// ---------- the reader's side of Cite from Library ----------
// The browser reader's cite port (plan reader-cite-popup D5): core's answerReaderCite over the library's projects, reading and writing their files through the library file system.

/**
 * @param listPapers the cached library papers a regenerated labshelf.bib draws from
 * An insert tells the library page's source tab of the file, which reloads it or merges it into its unsaved edits (writing/fileChanges.ts).
 */
export function createBrowserReaderCiteIo(
  fs: LibraryFileSystem, logger: ILogger, listPapers: () => Promise<PaperRecord[]> = listCachedPaperRecords,
): ReaderCiteIo {
  const content = createBrowserProjectContent({ fs, logger });
  const pathOf = (folder: string, path: string): string => posixPathOps.join(folder, path);
  return {
    projects: () => listReady(fs, logger),
    listFiles: (project) => createProjectNoteFiles(fs, async () => project.folder).list(project.settings.id),
    recentFiles: () => [],
    read: (project, path) => fs.readText(pathOf(project.folder, path)),
    async insert(project, path, offset, text) {
      const file = pathOf(project.folder, path);
      const raw = await fs.readText(file);
      await fs.writeText(file, raw.slice(0, offset) + text + raw.slice(offset));
      sendProjectFileChange({ projectId: project.settings.id, path });
    },
    // Puts the paper in the project's papers list and regenerates labshelf.bib from it; writes nothing when the user already listed the paper.
    async addToBibliography(project, paper) {
      const papers = withListedPaper(project.settings.papers ?? [], paper);
      if (!papers) return;
      await content.updateProjectSettings(project.folder, { papers });
      await content.updateProjectBibliography({ ...project, settings: { ...project.settings, papers } }, await listPapers());
    },
    async refreshBibliography(project) {
      await content.updateProjectBibliography(project, await listPapers());
    },
  };
}

/** @returns the reader's cite port over the library's projects; `paper` is the paper the page opened. */
export function createReaderCite(
  fs: LibraryFileSystem, logger: ILogger, paper: PaperRecord, listPapers?: () => Promise<PaperRecord[]>,
): (request: CiteRequest) => Promise<CiteReply> {
  const io = createBrowserReaderCiteIo(fs, logger, listPapers);
  return (request) => answerReaderCite(io, paper, request);
}
